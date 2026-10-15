import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useState, useSyncExternalStore, type ReactNode } from "react";
import { setFormatLang } from "./format";

export type Lang = "es" | "en";
const KEY = "medellin-social.lang";

/* ---------- Spanish → English dictionary ----------
 * Order matters: longer phrases first to avoid partial replacements
 * inside larger ones. Keep all-lowercase keys are matched
 * case-insensitively at word boundaries; cased keys match exactly.
 */
// PHRASES lives in ./i18n-phrases and is loaded on demand (see loadDictionary).

/* Tokens that should never be translated (brand, neighborhood names, etc.).
 * NOTE: UI labels and API category values (MUY SEGURO, ALTA, BAJA, Seguridad...)
 * are NOT protected any more: they have EN entries in PHRASES and must translate. */
const PROTECT = new Set([
  "Medellin Social", "Medellín Social", "Medellín", "Aburrá", "Airbnb", "Belén", "Estadio",
  "Laureles", "Robledo", "Aranjuez", "El Poblado", "El Rodeo",
  "Mapbox", "Fincaraíz", "Metrocuadrado", "PBN", "ADR", "CDT",
  "Google", "PSE", "Nequi",
]);


function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const hasLetters = (s: string) => (s.match(/\p{L}/gu) ?? []).length;
const isAllUpper = (s: string) => hasLetters(s) > 1 && s === s.toUpperCase() && s !== s.toLowerCase();
const capFirst = (s: string) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);
const lowerFirst = (s: string) =>
  s.length > 1 && s.charAt(1) === s.charAt(1).toUpperCase() && s.charAt(1) !== s.charAt(1).toLowerCase()
    ? s // acronym / proper noun ("WhatsApp", "ROI"): keep
    : s.charAt(0).toLowerCase() + s.slice(1);
const startsUpper = (s: string) => {
  const m = s.match(/\p{L}/u);
  return !!m && m[0] === m[0].toUpperCase() && m[0] !== m[0].toLowerCase();
};

/** Re-apply the casing of what was actually matched ("hasta" -> "up to", "DESDE" -> "FROM"). */
function matchCase(matched: string, es: string, en: string): string {
  if (matched === es) return en;
  if (isAllUpper(matched)) return en.toUpperCase();
  if (isAllUpper(es)) {
    // all-caps label key matched only with exact casing (see regex build), defensive:
    return en;
  }
  const mUp = startsUpper(matched);
  const kUp = startsUpper(es);
  if (mUp && !kUp) return capFirst(en);
  if (!mUp && kUp) return lowerFirst(en);
  return en;
}

// Unicode-aware boundaries on LETTERS only (so "3hab", "2baños", "100m²" match
// while "BUENOS AIRES" still never becomes "GOODS AIRES"). Matching is
// case-insensitive, except all-caps label keys (BAJA, ALTA, BAJO...) which only
// match exactly: lowercase "bajo" is the preposition "under", not the label.
let PHRASE_REGEXES: Array<{ re: RegExp; es: string; en: string }> = [];
let dictReady = false;
let dictPromise: Promise<void> | null = null;
const dictListeners = new Set<() => void>();

/** Lazy-load the ES->EN dictionary (own chunk). Spanish (default) never needs it. */
export function loadDictionary(): Promise<void> {
  if (dictReady) return Promise.resolve();
  if (!dictPromise) {
    dictPromise = import("./i18n-phrases").then(({ PHRASES }) => {
      // Sort once, longest phrases first so substrings don't pre-empt phrases.
      PHRASE_REGEXES = [...PHRASES]
        .sort((a, b) => b[0].length - a[0].length)
        .filter(([es]) => !PROTECT.has(es))
        .map(([es, en]) => ({
          re: new RegExp(`(?<!\\p{L})${escapeRegExp(es)}(?!\\p{L})`, isAllUpper(es) ? "gu" : "giu"),
          es,
          en,
        }));
      _tsCache.clear();
      dictReady = true;
      dictListeners.forEach((cb) => cb());
    });
    dictPromise.catch(() => { dictPromise = null; });
  }
  return dictPromise;
}
const subscribeDict = (cb: () => void) => {
  dictListeners.add(cb);
  return () => { dictListeners.delete(cb); };
};

// Numeric patterns that a static phrase table cannot express ("Hace 3 días").
const REL_UNITS: Record<string, [string, string]> = {
  minuto: ["minute", "minutes"], hora: ["hour", "hours"], día: ["day", "days"],
  semana: ["week", "weeks"], mes: ["month", "months"], año: ["year", "years"],
};
const REL_TIME_RE = /(?<!\p{L})hace (\d+) (minutos?|horas?|días?|semanas?|meses|mes|años?)(?!\p{L})/giu;
function relTime(_m: string, n: string, unit: string): string {
  const key = Object.keys(REL_UNITS).find((k) => unit.toLowerCase().startsWith(k));
  const pair = key ? REL_UNITS[key] : null;
  return `${n} ${pair ? (Number(n) === 1 ? pair[0] : pair[1]) : unit} ago`;
}

const _tsCache = new Map<string, string>();

export function translateString(input: string): string {
  if (!input) return input;
  const hit = _tsCache.get(input);
  if (hit !== undefined) return hit;
  let out = input.replace(REL_TIME_RE, relTime);
  for (const { re, es, en } of PHRASE_REGEXES) {
    re.lastIndex = 0;
    out = out.replace(re, (m) => matchCase(m, es, en));
  }
  if (dictReady) {
    if (_tsCache.size > 8000) _tsCache.clear();
    _tsCache.set(input, out);
  }
  return out;
}

/* ---- DOM walker ---- */
const TRANSLATABLE_ATTRS = ["placeholder", "title", "aria-label", "alt"];

// Opt-out for subtrees whose text is computed per-lang by React itself (e.g. a
// COP/USD price swap) — the DOM-diff translator would otherwise cache whatever
// it sees as "the Spanish original" and later restore stale/wrong text on toggle.
const SKIP_ATTR = "data-i18n-skip";
function skipFilter(node: Node): number {
  if (node.nodeType === Node.ELEMENT_NODE && (node as Element).hasAttribute(SKIP_ATTR)) {
    return NodeFilter.FILTER_REJECT;
  }
  return NodeFilter.FILTER_ACCEPT;
}
function isSkipped(t: Text): boolean {
  return t.parentElement?.closest(`[${SKIP_ATTR}]`) != null;
}

type AttrCache = Element & Record<string, string | undefined>;

// Same fresh-write guard as text nodes: if the attribute is not our own last
// translation, React wrote a new Spanish source -> re-cache it, never reuse the
// stale first-seen value.
function translateAttrs(el: Element) {
  const c = el as AttrCache;
  for (const a of TRANSLATABLE_ATTRS) {
    if (!el.hasAttribute(a)) continue;
    const cur = el.getAttribute(a) ?? "";
    const esKey = `__es_${a}`;
    const tKey = `__t_${a}`;
    if (c[tKey] !== cur) c[esKey] = cur;
    const next = translateString(c[esKey] ?? cur);
    if (next !== cur) el.setAttribute(a, next);
    c[tKey] = next;
  }
}

function translateNode(root: Node) {
  // TreeWalker never applies the filter to the root node itself — only to
  // nodes reached via nextNode(). Guard here so that skip-wrapped nodes
  // injected directly as addedNodes (e.g. Mapbox .setHTML fragments) are
  // not translated even when they arrive as the translateNode root.
  const host = root.nodeType === Node.ELEMENT_NODE ? (root as Element) : root.parentElement;
  if (host?.closest(`[${SKIP_ATTR}]`)) return;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT, skipFilter);
  let node: Node | null = walker.currentNode;
  while (node) {
    if (node.nodeType === Node.TEXT_NODE) {
      const el = node as Text & { __es?: string; __t?: string };
      const cur = el.nodeValue ?? "";
      // If the current value isn't our own last translation, React wrote a fresh
      // source (e.g. dynamic "$232.3k" label) → re-cache it as the ES original.
      if (el.__t !== cur) el.__es = cur;
      const next = translateString(el.__es ?? cur);
      if (next !== el.nodeValue) el.nodeValue = next;
      el.__t = next;
    } else if (node.nodeType === Node.ELEMENT_NODE) {
      const el = node as Element;
      const tag = el.tagName;
      if (tag === "SCRIPT" || tag === "STYLE") {
        node = walker.nextSibling();
        continue;
      }
      translateAttrs(el);
    }
    node = walker.nextNode();
  }
}

function restoreNode(root: Node) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT, skipFilter);
  let node: Node | null = walker.currentNode;
  while (node) {
    if (node.nodeType === Node.TEXT_NODE) {
      const el = node as Text & { __es?: string; __t?: string };
      // Only undo OUR translation; a fresh React write already is Spanish source.
      if (el.__es != null && el.__t === el.nodeValue && el.nodeValue !== el.__es) el.nodeValue = el.__es;
      el.__t = undefined;
    } else if (node.nodeType === Node.ELEMENT_NODE) {
      const el = node as AttrCache;
      for (const a of TRANSLATABLE_ATTRS) {
        const orig = el[`__es_${a}`];
        if (orig != null && el.getAttribute(a) === el[`__t_${a}`] && el.getAttribute(a) !== orig) el.setAttribute(a, orig);
        el[`__t_${a}`] = undefined;
      }
    }
    node = walker.nextNode();
  }
}

/* ---- Language store (cookie + localStorage, cross-tab, sync read) ---- */
function parseLang(v: unknown): Lang | null {
  return v === "es" || v === "en" ? v : null;
}

function readCookieLang(): Lang | null {
  if (typeof document === "undefined") return null;
  const m = document.cookie.match(new RegExp(`(?:^|; )${KEY.replace(/\./g, "\\.")}=([^;]*)`));
  return m ? parseLang(decodeURIComponent(m[1])) : null;
}

export function readStoredLang(): Lang {
  if (typeof window === "undefined") return "es";
  try {
    return parseLang(window.localStorage.getItem(KEY)) ?? readCookieLang() ?? "es";
  } catch {
    return readCookieLang() ?? "es";
  }
}

let currentLang: Lang | null = null;
const langListeners = new Set<() => void>();
let storageBound = false;

function getClientLang(): Lang {
  if (currentLang === null) {
    currentLang = readStoredLang();
    setFormatLang(currentLang);
    if (currentLang === "en") void loadDictionary();
  }
  return currentLang;
}
const getServerLang = (): Lang => "es";

function publishLang(l: Lang) {
  currentLang = l;
  if (l === "en") void loadDictionary();
  setFormatLang(l);
  langListeners.forEach((cb) => cb());
}

function subscribeLang(cb: () => void): () => void {
  langListeners.add(cb);
  if (typeof window !== "undefined" && !storageBound) {
    storageBound = true;
    window.addEventListener("storage", (e) => {
      if (e.key === KEY || e.key === null) {
        const next = parseLang(e.newValue) ?? readStoredLang();
        if (next !== currentLang) publishLang(next);
      }
    });
  }
  return () => {
    langListeners.delete(cb);
  };
}

export function persistLang(l: Lang): void {
  if (typeof window !== "undefined") {
    try {
      window.localStorage.setItem(KEY, l);
    } catch {
      /* storage blocked */
    }
    try {
      document.cookie = `${KEY}=${l}; path=/; max-age=31536000; SameSite=Lax`;
    } catch {
      /* cookies blocked */
    }
  }
  publishLang(l);
}

/* ---- Context ---- */
type Ctx = { lang: Lang; setLang: (l: Lang) => void; toggle: () => void; t: (s: string) => string };
const LangCtx = createContext<Ctx>({ lang: "es", setLang: () => {}, toggle: () => {}, t: (s) => s });

let observer: MutationObserver | null = null;
let titleObserver: MutationObserver | null = null;

// useLayoutEffect on the client so the translation lands before first paint.
const useIsoLayoutEffect = typeof window !== "undefined" ? useLayoutEffect : useEffect;

let titleEs: string | null = null;
let titleT: string | null = null;
function translateTitle() {
  const cur = document.title;
  if (titleT !== cur) titleEs = cur; // fresh write by a route/drawer
  const next = translateString(titleEs ?? cur);
  if (next !== document.title) document.title = next;
  titleT = next;
}
function restoreTitle() {
  if (titleEs != null && titleT === document.title) document.title = titleEs;
  titleEs = null;
  titleT = null;
}

export function LanguageProvider({ children }: { children: React.ReactNode }) {
  // SSR + hydration render "es" (matches server HTML); the client snapshot is
  // read synchronously right after hydration, before paint.
  const lang = useSyncExternalStore(subscribeLang, getClientLang, getServerLang);
  // Re-run the translation pass once the lazy dictionary chunk arrives.
  const dictLoaded = useSyncExternalStore(subscribeDict, () => dictReady, () => false);

  // Apply translation when lang changes; observe DOM mutations while in EN.
  useIsoLayoutEffect(() => {
    if (typeof window === "undefined") return;
    document.documentElement.lang = lang;

    // Stop any previous observers first.
    if (observer) {
      observer.disconnect();
      observer = null;
    }
    if (titleObserver) {
      titleObserver.disconnect();
      titleObserver = null;
    }

    if (lang === "en") {
      translateNode(document.body);
      translateTitle();
      const titleEl = document.querySelector("title");
      if (titleEl) {
        titleObserver = new MutationObserver(() => translateTitle());
        titleObserver.observe(titleEl, { childList: true, characterData: true, subtree: true });
      }
      observer = new MutationObserver((mutations) => {
        for (const m of mutations) {
          if (m.type === "childList") {
            m.addedNodes.forEach((n) => translateNode(n));
          } else if (m.type === "characterData") {
            const t = m.target as Text & { __es?: string; __t?: string };
            if (isSkipped(t)) continue;
            const cur = t.nodeValue ?? "";
            // Fresh React write (not our echo) → re-cache as new ES source.
            if (t.__t !== cur) t.__es = cur;
            const next = translateString(t.__es ?? cur);
            if (next !== t.nodeValue) t.nodeValue = next;
            t.__t = next;
          } else if (m.type === "attributes" && m.attributeName) {
            if (TRANSLATABLE_ATTRS.includes(m.attributeName) && m.target.nodeType === Node.ELEMENT_NODE) {
              const el = m.target as Element;
              if (!el.closest(`[${SKIP_ATTR}]`)) translateAttrs(el);
            }
          }
        }
      });
      observer.observe(document.body, {
        childList: true,
        subtree: true,
        characterData: true,
        attributes: true,
        attributeFilter: TRANSLATABLE_ATTRS,
      });
    } else {
      restoreNode(document.body);
      restoreTitle();
    }

    return () => {
      if (observer) {
        observer.disconnect();
        observer = null;
      }
      if (titleObserver) {
        titleObserver.disconnect();
        titleObserver = null;
      }
    };
  }, [lang, dictLoaded]);

  const setLang = useCallback((l: Lang) => persistLang(l), []);
  const toggle = useCallback(() => persistLang(lang === "es" ? "en" : "es"), [lang]);
  const t = useCallback((s: string) => (lang === "en" ? translateString(s) : s), [lang, dictLoaded]);

  return <LangCtx.Provider value={{ lang, setLang, toggle, t }}>{children}</LangCtx.Provider>;
}

/** @internal exposed for tests only */
export const __i18nInternals = { translateNode, restoreNode, readStoredLang, PROTECT };

export function useLang() {
  return useContext(LangCtx);
}

/** Strings built in code (templates, aria-labels, toasts): pass both languages.
 *
 *  The app has one translation policy, applied per kind of text:
 *   - static JSX copy: Spanish in source, English from PHRASES (DOM pass; enforced by
 *     i18n.scan.test.ts, which fails on any untranslated literal);
 *   - text assembled in code: useT()(es, en) — never concatenate dictionary fragments;
 *   - names from the API: <Name> (never translated);
 *   - API enum codes: lib/enumLabels.ts tables. */
export function useT() {
  const { lang } = useLang();
  return useCallback((es: string, en: string) => (lang === "en" ? en : es), [lang]);
}

// ── Free on-device translation for free-text (listing descriptions) ──────────
// The dict translator (translateString) only swaps known phrases → free text
// comes out half-translated ("Spanglish"). For unbounded text we use the browser
// Translator API (Chrome/Edge 138+): on-device model, no key, no server, no cost.
// Everywhere the API is absent (Firefox/Safari/old Chrome) we return the original
// Spanish unchanged — never Spanglish. Wrap the text node in data-i18n-skip so the
// dict translator leaves it to us.
// ponytail: single es→en translator + Map cache; add per-pair translators only if
// we ever translate more than the two app languages.
const _mtCache = new Map<string, string>();
let _translatorP: Promise<{ translate: (t: string) => Promise<string> } | null> | null = null;

function getTranslator() {
  if (typeof self === "undefined" || !("Translator" in self)) return null;
  if (!_translatorP) {
    _translatorP = (self as unknown as { Translator: { create: (o: object) => Promise<{ translate: (t: string) => Promise<string> }> } })
      .Translator.create({ sourceLanguage: "es", targetLanguage: "en" })
      .catch(() => null);
  }
  return _translatorP;
}

/** Returns `text` translated to EN via the on-device model when lang==="en" and
 *  the API exists; otherwise returns `text` verbatim (Spanish). */
export function useAutoTranslate(text: string): string {
  const { lang } = useLang();
  const [out, setOut] = useState(text);
  useEffect(() => {
    if (lang !== "en" || !text) { setOut(text); return; }
    const cached = _mtCache.get(text);
    if (cached != null) { setOut(cached); return; }
    const tp = getTranslator();
    if (!tp) { setOut(text); return; }
    let alive = true;
    tp.then((t) => (t ? t.translate(text) : text))
      .then((en) => {
        if (!alive) return;
        const val = en || text;
        _mtCache.set(text, val);
        setOut(val);
      })
      .catch(() => { if (alive) setOut(text); });
    return () => { alive = false; };
  }, [text, lang]);
  return out;
}

/** Proper names from the API (barrios, comunas, businesses, agents, buildings) must
 *  never go through the phrase dictionary ("Casa Blanca" -> "House Blanca"). */
export function Name({ children }: { children: ReactNode }) {
  return <span data-i18n-skip>{children}</span>;
}

/** Inline free-text auto-translated (Chrome/Edge Translator API) when EN, else the
 *  original Spanish. data-i18n-skip keeps the dict translator out (no Spanglish).
 *  Use for scraped/user free text (listing descriptions) — NOT names/titles. */
export function AutoTranslate({ text }: { text: string }) {
  const t = useAutoTranslate(text);
  return <span data-i18n-skip>{t}</span>;
}

// Inline SVG flags — flag emoji (🇨🇴/🇺🇸) fall back to plain "CO"/"US" text on
// Windows (its default fonts have no flag glyphs for regional-indicator pairs).
// Real SVG renders identically on every OS/browser.
export function FlagCO({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size * (2 / 3)} viewBox="0 0 900 600" aria-hidden="true">
      <rect width="900" height="600" fill="#FCD116" />
      <rect width="900" height="150" y="300" fill="#003893" />
      <rect width="900" height="150" y="450" fill="#CE1126" />
    </svg>
  );
}

export function FlagUS({ size = 18 }: { size?: number }) {
  const stripeH = 100 / 13;
  const stripes = Array.from({ length: 13 }, (_, i) => (
    <rect key={i} x={0} y={i * stripeH} width={190} height={stripeH} fill={i % 2 === 0 ? "#B22234" : "#FFFFFF"} />
  ));
  const cantonH = stripeH * 7;
  const stars = [];
  for (let row = 0; row < 4; row++) {
    for (let col = 0; col < 5; col++) {
      stars.push(
        <circle key={`${row}-${col}`} cx={8 + col * 15} cy={7 + row * 12} r={1.6} fill="#FFFFFF" />
      );
    }
  }
  return (
    <svg width={size} height={size * (100 / 190)} viewBox="0 0 190 100" aria-hidden="true">
      {stripes}
      <rect x={0} y={0} width={76} height={cantonH} fill="#3C3B6E" />
      {stars}
    </svg>
  );
}

export function LanguageToggle({ className = "" }: { className?: string }) {
  const { lang, setLang } = useLang();
  return (
    <div className={"inline-flex gap-1 " + className}>
      {(["es", "en"] as const).map(l => (
        <button
          key={l}
          onClick={() => setLang(l)}
          title={l === "es" ? "Español (Colombia)" : "English (USA)"}
          aria-label={l === "es" ? "Español" : "English"}
          aria-pressed={lang === l}
          data-testid={`lang-${l}`}
          className="rounded-full border transition"
          style={{
            border: `1.5px solid ${lang === l ? "rgba(29,158,117,0.8)" : "rgba(255,255,255,0.35)"}`,
            background: lang === l ? "rgba(29,158,117,0.22)" : "rgba(255,255,255,0.1)",
            padding: "3px 8px",
            cursor: lang === l ? "default" : "pointer",
            display: "flex", alignItems: "center",
          }}
        >
          {l === "es" ? <FlagCO /> : <FlagUS />}
        </button>
      ))}
    </div>
  );
}
