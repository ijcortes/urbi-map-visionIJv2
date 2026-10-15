"""Alert hook. The repo has no Slack/email alerting; it has Sentry (SENTRY_DSN) and logs.
So: always log at ERROR, send to Sentry if configured, POST to LINK_CHECK_ALERT_WEBHOOK
(Slack-compatible {"text": ...}) if set. Never raises."""
from __future__ import annotations

import logging
import os

log = logging.getLogger("link_checker.alert")


def send_alert(message: str, webhook: str = "") -> None:
    log.error("LINK CHECK ALERT: %s", message)
    try:
        if os.getenv("SENTRY_DSN"):
            import sentry_sdk
            sentry_sdk.capture_message(f"link_checker: {message}", level="error")
    except Exception:  # pragma: no cover
        log.exception("sentry alert failed")
    if webhook:
        try:
            import httpx
            httpx.post(webhook, json={"text": f":warning: link_checker: {message}"}, timeout=10)
        except Exception:  # pragma: no cover
            log.exception("webhook alert failed")
