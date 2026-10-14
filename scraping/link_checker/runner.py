"""Batch driver: queue -> fetch -> brake -> persist."""
from __future__ import annotations

import asyncio
import logging
from collections import Counter, defaultdict
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone

from . import store
from .alerts import send_alert
from .classify import BLOCKED, ERROR, GONE, OK, REDIRECTED
from .config import Markers, Settings
from .fetcher import LinkFetcher
from .state import SUSPECT, next_state

log = logging.getLogger("link_checker")


@dataclass
class RunReport:
    checked: int = 0
    per_source: dict = field(default_factory=lambda: defaultdict(Counter))
    candidates: list = field(default_factory=list)     # new pending_review (human review), NOT deactivated
    auto_retired: int = 0
    digest: dict = field(default_factory=dict)
    reactivated: list = field(default_factory=list)
    braked_sources: list = field(default_factory=list)
    alerts: list = field(default_factory=list)
    skipped: int = 0
    dry_run: bool = False

    @property
    def exit_code(self) -> int:
        return 2 if self.alerts else 0

    def log_counts(self):
        for src, c in sorted(self.per_source.items()):
            log.info("link-health source=%s %s", src, " ".join(f"{k}={v}" for k, v in sorted(c.items())))
        log.info("link-health total checked=%d skipped=%d new_review_candidates=%d auto_retired=%d reactivated=%d dry_run=%s",
                 self.checked, self.skipped, len(self.candidates), self.auto_retired, len(self.reactivated), self.dry_run)


async def _gather_results(fetcher: LinkFetcher, items: list[dict]) -> list[tuple[dict, str, object]]:
    # one task per domain keeps ordering polite; across domains everything runs in parallel
    by_domain: dict[str, list[dict]] = defaultdict(list)
    from urllib.parse import urlparse
    for it in items:
        by_domain[(urlparse(it["url"]).hostname or "").lower()].append(it)
    out: list = []

    async def work(group):
        for it in group:
            v, f = await fetcher.check(it["url"])
            out.append((it, v, f))

    # concurrency within a domain comes from the pacer; spawn `domain_concurrency` workers per domain
    tasks = []
    n = max(1, fetcher.cfg.domain_concurrency)
    for group in by_domain.values():
        for i in range(n):
            tasks.append(work(group[i::n]))
    await asyncio.gather(*tasks)
    return out


async def run(conn, cfg: Settings, *, sources: list[str] | None = None, limit: int = 500,
              older_than: timedelta = timedelta(hours=24), dry_run: bool = False,
              fetcher: LinkFetcher | None = None, markers: Markers | None = None,
              now: datetime | None = None, sender=None) -> RunReport:
    markers = markers or Markers()
    sources = sources or store.DEFAULT_SOURCES
    rep = RunReport(dry_run=dry_run)
    queue = await store.fetch_queue(conn, sources, limit, older_than)
    if not queue:
        log.info("link-health: queue empty")
        if not dry_run:       # still deliver reminders / auto-retire for already pending candidates
            from api.services import link_review
            rep.auto_retired = await link_review.auto_retire(conn)
            rep.digest = await link_review.maybe_send_digest(conn, sender=sender, braked=[], alerts=[])
        return rep
    own = fetcher is None
    fetcher = fetcher or LinkFetcher(cfg, markers)
    try:
        raw = await _gather_results(fetcher, queue)
    finally:
        if own:
            await fetcher.aclose()

    # -- mass-gone brake (per source), decided on the WHOLE sample before anything is written
    tally: dict[str, Counter] = defaultdict(Counter)
    for it, v, _ in raw:
        if v.result != "skipped":
            tally[it["fuente"]][v.result] += 1
    braked: set[str] = set()
    for src, c in tally.items():
        n = sum(c.values())
        if n >= cfg.brake_min_sample:
            if c[GONE] * 100.0 / n > cfg.max_gone_pct:
                braked.add(src)
                msg = (f"{src}: {c[GONE]}/{n} ({c[GONE]*100.0/n:.0f}%) checked links look gone in ONE run "
                       f"(> {cfg.max_gone_pct:.0f}%): likely portal layout change or block, NOT mass delisting. "
                       "Nothing proposed for review for this source.")
                rep.alerts.append(msg)
            if c[BLOCKED] * 100.0 / n > cfg.max_blocked_pct:
                rep.alerts.append(f"{src}: {c[BLOCKED]}/{n} requests blocked (403/429/captcha); reduce rate or check UA/IP.")
    rep.braked_sources = sorted(braked)

    now = now or datetime.now(timezone.utc)
    prev = await store.load_prev(conn, [it["url"] for it, _, _ in raw])
    ok_urls: dict[str, list[str]] = defaultdict(list)
    for it, v, f in raw:
        if v.result == "skipped":
            rep.skipped += 1
            continue
        src, url = it["fuente"], it["url"]
        result = SUSPECT if (v.result == GONE and src in braked) else v.result
        rep.checked += 1
        rep.per_source[src][result] += 1
        def compute(p, _r=result, _f=f, _v=v, _u=url):
            return next_state(p, _r, now=now, cfg=cfg, http_status=_f.status,
                              final_url=_f.final_url if _f.final_url != _u else None, error=_v.reason if _v.result != OK else None)
        log.debug("%s %s -> %s (%s)", src, url, result, v.reason)
        if dry_run:
            st = compute(prev.get(url))
            if st["confirmed_gone_now"]:
                rep.candidates.append((src, url))      # would-be review candidate
            continue
        # fresh row under lock: never overwrite a Keep/Retire that landed while this run was fetching
        st = await store.locked_update(conn, url, src, compute)
        if st["confirmed_gone_now"]:
            rep.candidates.append((src, url))          # link hidden via status; listing stays ACTIVE until a human approves
        elif st["recovered"]:
            if await store.reactivate_listing(conn, src, url):
                rep.reactivated.append((src, url))
        if result in (OK, REDIRECTED):
            ok_urls[src].append(url)
    if not dry_run:
        for src, urls in ok_urls.items():
            await store.mark_seen_ok(conn, src, urls)

    rep.log_counts()
    for a in rep.alerts:
        send_alert(a, cfg.alert_webhook if not dry_run else "")
    if not dry_run:
        from api.services import link_review
        rep.auto_retired = await link_review.auto_retire(conn, rep.braked_sources)     # no-op unless LINK_AUTO_RETIRE_AFTER_DAYS > 0
        rep.digest = await link_review.maybe_send_digest(conn, sender=sender, braked=rep.braked_sources, alerts=rep.alerts)
        log.info("review digest: %s", rep.digest)
    return rep
