import { useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X, GraduationCap } from "@/lib/icons";
import { useLang } from "@/lib/i18n";

const LS_KEY = "home_tour_seen";
const PAD = 8; // spotlight ring padding around target rect
const FIND_TIMEOUT_MS = 2500;

type LocStr = { es: string; en: string };
type TourStep = {
  title: LocStr;
  body: LocStr;
  selector?: string; // CSS selector for the real element to spotlight — best-effort
  icon?: string;      // shown when there's no live target to point at
  mobileOnly?: boolean;
  desktopOnly?: boolean;
};

const ALL_STEPS: TourStep[] = [
  {
    title: { es: "Bienvenido a Medellín Social", en: "Welcome to Medellín Social" },
    body: {
      es: "Te mostramos rápido cómo moverte por el sitio: sus páginas, el mapa de inicio y tu barrio.",
      en: "Let's take a quick look around: the pages, the home map and how to get around your barrio.",
    },
    icon: "🏠",
  },
  {
    title: { es: "Menú de navegación", en: "Navigation menu" },
    body: {
      es: "Desde aquí vas a Eventos, Negocios, Real Estate y Blog de tu barrio.",
      en: "From here you reach Events, Businesses, Real Estate and Blog for your barrio.",
    },
    selector: '[data-tour="nav-links"]',
    desktopOnly: true,
  },
  {
    title: { es: "Menú de navegación", en: "Navigation menu" },
    body: {
      es: "Toca el ☰ para ver Eventos, Negocios, Real Estate y Blog.",
      en: "Tap ☰ to see Events, Businesses, Real Estate and Blog.",
    },
    selector: '[data-tour="nav-hamburger"]',
    mobileOnly: true,
  },
  {
    title: { es: "Elige tu barrio", en: "Choose your barrio" },
    body: {
      es: "Elige un barrio y vas directo a su página.",
      en: "Pick a barrio and go straight to its page.",
    },
    selector: '[data-tour="barrio-select"]',
  },
  {
    title: { es: "Explora tu barrio", en: "Explore your barrio" },
    body: {
      es: "Toca una comuna en el mapa (o en la lista) y entras a su página: embajador, eventos, propiedades y negocios.",
      en: "Tap a comuna on the map (or the list) to open its page: ambassador, events, listings and businesses.",
    },
    selector: '[data-tour="home-explorar"]',
  },
  {
    title: { es: "Lo último del barrio", en: "Latest from the barrio" },
    body: { es: "Lo que acaba de pasar en tu zona.", en: "What just happened in your area." },
    selector: '[data-tour="home-noticias"]',
  },
  {
    title: { es: "Qué hacer esta semana", en: "What to do this week" },
    body: { es: "Los planes de esta semana en tu barrio.", en: "The plans lined up this week in your barrio." },
    selector: '[data-tour="home-eventos-semana"]',
  },
  {
    title: { es: "Hotspots & Deals", en: "Hotspots & Deals" },
    body: { es: "Promos que solo consigues con negocios de la zona.", en: "Deals you only get with businesses around here." },
    selector: '[data-tour="home-deals"]',
  },
  {
    title: { es: "Directorio 5 Estrellas", en: "5-Star Directory" },
    body: { es: "Los negocios que mejor califica la gente, ordenados por categoría.", en: "The businesses people rate highest, sorted by category." },
    selector: '[data-tour="home-directorio"]',
  },
  {
    title: { es: "Mapa de inversión", en: "Investment map" },
    body: {
      es: "Aquí entras al mapa completo de inmuebles, con filtros de precio, tipo y mucho más. Ese mapa trae su propio tutorial.",
      en: "Here you open the full real-estate map, with filters for price, type and lots more. That map has its own tutorial.",
    },
    selector: '[data-tour="home-realestate"]',
  },
  {
    title: { es: "¿Necesitas repasar esto?", en: "Need to review this?" },
    body: {
      es: "¿Se te perdió algo? Con este botón repites la guía cuando quieras.",
      en: "Missed something? This button replays the guide whenever you want.",
    },
    selector: '[data-tour="tour-replay-home"]',
  },
];

export function HomeTourModal({ isMobile }: { isMobile: boolean }) {
  const [step, setStep] = useState(0);
  const [show, setShow] = useState(false);
  const [rect, setRect] = useState<DOMRect | null>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);
  const { lang } = useLang();
  const tr = (o: LocStr) => (lang === "es" ? o.es : o.en);
  const tt = (es: string, en: string) => (lang === "es" ? es : en);

  const STEPS = ALL_STEPS.filter((s) => (!s.mobileOnly || isMobile) && (!s.desktopOnly || !isMobile));

  useEffect(() => {
    if (localStorage.getItem(LS_KEY) === "true") return;
    const t = setTimeout(() => setShow(true), 600);
    return () => clearTimeout(t);
  }, []);

  // Best-effort spotlight: poll for the target, scroll it into view once found,
  // then keep tracking its rect (it moves while the page scrolls).
  useEffect(() => {
    if (!show) return;
    const selector = STEPS[step]?.selector;
    if (!selector) { setRect(null); return; }
    let raf = 0;
    let cancelled = false;
    let scrolled = false;
    const start = performance.now();
    const tick = () => {
      if (cancelled) return;
      const el = document.querySelector(selector);
      if (el) {
        if (!scrolled) {
          el.scrollIntoView({ behavior: "smooth", block: "center" });
          scrolled = true;
        }
        setRect(el.getBoundingClientRect());
        raf = requestAnimationFrame(tick);
      } else if (performance.now() - start < FIND_TIMEOUT_MS) {
        raf = requestAnimationFrame(tick);
      } else {
        setRect(null); // gave up — fall back to a centered tooltip
      }
    };
    tick();
    return () => { cancelled = true; cancelAnimationFrame(raf); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, show]);

  const finish = () => {
    setShow(false);
    setRect(null);
    try { localStorage.setItem(LS_KEY, "true"); } catch { /* storage blocked */ }
    // El último paso deja la página scrolleada a mitad (real estate) — volver arriba.
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const replay = () => {
    setStep(0);
    setRect(null);
    setShow(true);
  };

  const s = STEPS[step];
  const isLast = step === STEPS.length - 1;

  const wrapperStyle: React.CSSProperties = rect
    ? {
        position: "fixed",
        left: Math.min(Math.max(rect.left, 16), window.innerWidth - 336),
        top: rect.bottom + PAD * 2 + 12 < window.innerHeight - 160
          ? rect.bottom + PAD * 2 + 12
          : Math.max(rect.top - 12 - 220, 16),
      }
    : {
        position: "fixed", inset: 0,
        display: "flex", alignItems: "center", justifyContent: "center",
      };

  const card = (
    <motion.div
      ref={tooltipRef}
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.95 }}
      transition={{ duration: 0.2 }}
      className="pointer-events-auto w-[320px] max-w-[92vw] rounded-2xl shadow-2xl"
      style={{ background: "#FAF8F3", border: "1px solid #E5E0D5" }}
    >
      <button
        onClick={finish}
        aria-label={tt("Cerrar guía", "Close guide")}
        className="absolute right-2.5 top-2.5 grid h-7 w-7 place-items-center rounded-full text-[#5B5F5C] transition hover:bg-[#E5E0D5] hover:text-[#111418]"
      >
        <X className="h-3.5 w-3.5" />
      </button>

      <div className="p-5 pb-4">
        <div className="h-1 w-full overflow-hidden rounded-full" style={{ background: "#E5E0D5" }}>
          <div className="h-full rounded-full transition-all" style={{ width: `${((step + 1) / STEPS.length) * 100}%`, background: "#0F8A4F" }} />
        </div>

        <h2 data-i18n-skip className="mt-3 font-display text-lg font-semibold leading-tight text-[#111418]">{tr(s.title)}</h2>
        <p data-i18n-skip className="mt-1.5 text-sm text-[#5B5F5C]">{tr(s.body)}</p>
        {s.icon && <div className="mt-3 text-center text-3xl">{s.icon}</div>}

        <div className="mt-4 flex items-center justify-between">
          <button
            onClick={finish}
            className="text-xs font-medium text-[#5B5F5C] transition hover:text-[#111418] hover:underline"
          >
            {tt("Saltar recorrido", "Skip tour")}
          </button>
          <div className="flex gap-2">
            {step > 0 && (
              <button
                onClick={() => setStep((n) => n - 1)}
                className="rounded-lg px-3 py-1.5 text-sm font-medium text-[#5B5F5C] transition hover:bg-[#E5E0D5]"
              >
                {tt("Atrás", "Back")}
              </button>
            )}
            <button
              onClick={() => (isLast ? finish() : setStep((n) => n + 1))}
              className="rounded-lg px-4 py-1.5 text-sm font-semibold text-white transition hover:opacity-90"
              style={{ background: "#0F8A4F" }}
            >
              {isLast ? tt("Entendido", "Got it") : tt("Siguiente", "Next")}
            </button>
          </div>
        </div>
      </div>
    </motion.div>
  );

  return (
    <>
      <button
        onClick={replay}
        aria-label={tt("Tutorial del sitio", "Site tutorial")}
        data-tour="tour-replay-home"
        className="fixed z-[45] flex items-center gap-1.5 whitespace-nowrap rounded-full px-3 py-1.5 text-xs font-semibold shadow-md transition hover:opacity-90"
        style={{ bottom: 20, right: 20, background: "#FAF8F3", border: "1px solid #E5E0D5", color: "#0F8A4F" }}
      >
        <GraduationCap size={14} />
        {tt("Tutorial del sitio", "Site tutorial")}
      </button>

      <AnimatePresence>
        {show && (
          <>
            {rect ? (
              <div
                className="pointer-events-none fixed z-[9998] rounded-xl border-2"
                style={{
                  left: rect.left - PAD, top: rect.top - PAD,
                  width: rect.width + PAD * 2, height: rect.height + PAD * 2,
                  borderColor: "#0F8A4F",
                  boxShadow: "0 0 0 9999px rgba(20,18,8,0.55)",
                  transition: "left .2s ease, top .2s ease, width .2s ease, height .2s ease",
                }}
              />
            ) : (
              <div className="pointer-events-none fixed inset-0 z-[9998]" style={{ background: "rgba(20,18,8,0.45)" }} />
            )}

            <div className="pointer-events-none fixed z-[9999]" style={wrapperStyle}>
              {card}
            </div>
          </>
        )}
      </AnimatePresence>
    </>
  );
}
