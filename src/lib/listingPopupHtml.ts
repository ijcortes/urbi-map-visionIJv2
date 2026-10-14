// Pure builder for the Mapbox listing popup HTML. Language- and currency-aware
// (no reliance on the DOM translator, which cannot see Mapbox-injected markup
// reliably and mangles digits+units such as "3hab").
import { type Currency, type FmtLang, formatMoney, formatPerArea, copToUsd, formatNumber, M2_PER_FT2 } from "./format";

export type PopupCtx = {
  lang: FmtLang;
  currency: Currency; // effective display currency (COP while the TRM is loading)
  trm: number | null;
  unit: "m2" | "sqft";
};

type BarrioLike = {
  mercado?: { arriendo_p50_cop?: number | null } | null;
  scores?: { score_activo?: number | null } | null;
} | null | undefined;

const T = {
  es: {
    sale: "VENTA", rent: "ARRIENDO",
    good: "BUENA OFERTA", belowMedian: "bajo la mediana del barrio",
    over: "SOBRE PRECIO", aboveMedian: "sobre la mediana",
    fair: "PRECIO JUSTO", inRange: "Dentro del rango del barrio",
    yieldEst: "Yield estimado", zoneScore: "Score zona",
    ppa: "Precio", median: "Mediana zona",
    viewListing: "Ver listado →", agent: "Agente 💬",
    score: { high: "EXCELENTE", good: "BUENO", mid: "MODERADO", low: "BAJO" },
    wa: (barrio: string, price: string) => `Hola, estoy interesado en una propiedad en ${barrio} de ${price}. ¿Pueden ayudarme?`,
    beds: "hab", baths: "baños",
  },
  en: {
    sale: "SALE", rent: "RENT",
    good: "GOOD DEAL", belowMedian: "below the neighborhood median",
    over: "OVERPRICED", aboveMedian: "above the median",
    fair: "FAIR PRICE", inRange: "Within the neighborhood range",
    yieldEst: "Estimated yield", zoneScore: "Area score",
    ppa: "Price", median: "Area median",
    viewListing: "View listing →", agent: "Agent 💬",
    score: { high: "EXCELLENT", good: "GOOD", mid: "MODERATE", low: "LOW" },
    wa: (barrio: string, price: string) => `Hi, I'm interested in a property in ${barrio} listed at ${price}. Can you help me?`,
    beds: "bd", baths: "ba",
  },
} as const;

export function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

export function popupScoreLabel(s: number, lang: FmtLang): string {
  const L = T[lang].score;
  if (s >= 70) return L.high;
  if (s >= 55) return L.good;
  if (s >= 40) return L.mid;
  return L.low;
}

function money(cop: number, ctx: PopupCtx): string {
  return ctx.currency === "USD" && ctx.trm ? formatMoney(copToUsd(cop, ctx.trm), "USD", ctx.lang) : formatMoney(cop, "COP", ctx.lang);
}
function secondary(cop: number, ctx: PopupCtx): string | null {
  if (ctx.currency === "USD") return `~${formatMoney(cop, "COP", ctx.lang)}`;
  return ctx.trm ? `~${formatMoney(copToUsd(cop, ctx.trm), "USD", ctx.lang)}` : null;
}
function perArea(copPerM2: number, ctx: PopupCtx): string {
  const v = ctx.currency === "USD" && ctx.trm ? copToUsd(copPerM2, ctx.trm) : copPerM2;
  return formatPerArea(v, ctx.currency === "USD" && ctx.trm ? "USD" : "COP", ctx.unit, ctx.lang);
}

export function buildListingPopupHTML(
  props: Record<string, unknown>,
  barrio: BarrioLike,
  ctx: PopupCtx,
): string {
  const t = T[ctx.lang];
  const precio_cop   = (props.precio_cop   as number | null) ?? null;
  const precio_m2    = (props.precio_m2    as number | null) ?? null;
  const mediana      = (props.precio_m2_mediana_barrio as number | null) ?? null;
  const area_m2      = (props.area_m2      as number | null) ?? null;
  const habitaciones = (props.habitaciones as number | null) ?? null;
  const banos        = (props.banos        as number | null) ?? null;
  const tipo_op      = (props.tipo_op      as string) ?? "venta";
  const tipo_inmueble= (props.tipo_inmueble as string) ?? "";
  const barrio_nombre= (props.barrio_nombre as string) ?? "";
  const fuente       = ((props.fuente      as string) ?? "").toLowerCase();
  const url          = (props.url          as string) ?? "";

  const isRent = tipo_op === "arriendo";
  const tipoBg    = isRent ? "#E7F4EC" : "#FCE8EA";
  const tipoColor = isRent ? "#0F8A4F" : "#CE1126";
  const tipoBadge = `<span style="background:${tipoBg};color:${tipoColor};padding:2px 8px;border-radius:4px;font-size:10px;font-weight:700;letter-spacing:.05em;">${isRent ? t.rent : t.sale}</span>`;
  const inmBadge  = tipo_inmueble
    ? `<span data-i18n-skip style="background:rgba(26,18,8,.07);color:#5B5F5C;padding:2px 8px;border-radius:4px;font-size:10px;font-weight:600;text-transform:capitalize;">${escapeHtml(tipo_inmueble.replace(/_/g, " "))}</span>`
    : "";

  const areaTxt = area_m2
    ? ctx.unit === "sqft"
      ? `${formatNumber(Math.round(area_m2 * M2_PER_FT2), ctx.lang)} ft²`
      : `${formatNumber(area_m2, ctx.lang, 1)} m²`
    : null;
  const specs = [
    areaTxt       ? `📐 ${areaTxt}` : null,
    habitaciones  ? `🛏️ ${habitaciones} ${t.beds}` : null,
    banos         ? `🚿 ${banos} ${t.baths}` : null,
  ].filter(Boolean).join("&nbsp;&nbsp;");

  let badgeHTML = "";
  if (!isRent && precio_m2 && mediana && mediana > 0) {
    const diff = (precio_m2 - mediana) / mediana * 100;
    if (diff < -10)
      badgeHTML = `<div style="margin-top:8px;"><div style="color:#0A5C36;font-weight:700;font-size:12px;">🟢 ${t.good}</div><div style="color:#6E726E;font-size:11px;">${Math.abs(diff).toFixed(0)}% ${t.belowMedian}</div></div>`;
    else if (diff > 15)
      badgeHTML = `<div style="margin-top:8px;"><div style="color:#CE1126;font-weight:700;font-size:12px;">🔴 ${t.over}</div><div style="color:#6E726E;font-size:11px;">${diff.toFixed(0)}% ${t.aboveMedian}</div></div>`;
    else
      badgeHTML = `<div style="margin-top:8px;"><div style="color:#6E726E;font-weight:700;font-size:12px;">⚪ ${t.fair}</div><div style="color:#6E726E;font-size:11px;">${t.inRange}</div></div>`;
  }

  let yieldHTML = "";
  if (!isRent && precio_cop && barrio?.mercado?.arriendo_p50_cop) {
    const y = barrio.mercado.arriendo_p50_cop * 12 / precio_cop * 100;
    if (y > 0 && y < 30)
      yieldHTML = `<div style="color:#6E726E;font-size:11px;">${t.yieldEst}: <strong style="color:#111418;">${y.toFixed(1)}%</strong></div>`;
  }

  let scoreHTML = "";
  if (barrio?.scores?.score_activo != null) {
    const s = barrio.scores.score_activo;
    scoreHTML = `<div style="color:#6E726E;font-size:11px;">${t.zoneScore}: <strong style="color:#0F8A4F;">${s}</strong> · ${popupScoreLabel(s, ctx.lang)}</div>`;
  }

  const sourceMap: Record<string, string> = {
    fincaraiz:      ctx.lang === "en" ? "View on Fincaraíz →" : "Ver en Fincaraíz →",
    metrocuadrado:  ctx.lang === "en" ? "View on Metrocuadrado →" : "Ver en Metrocuadrado →",
    medellinliving: ctx.lang === "en" ? "View on MedellinLiving →" : "Ver en MedellinLiving →",
  };
  const sourceLabel = sourceMap[fuente] ?? t.viewListing;
  const waText = encodeURIComponent(t.wa(barrio_nombre, precio_cop ? money(precio_cop, ctx) : "—"));
  const waUrl  = `https://wa.me/+573122502394?text=${waText}`;
  const btnBase = `cursor:pointer;padding:6px 10px;border-radius:6px;font-size:11px;font-weight:600;border:1px solid;`;
  const btnSrc = url
    ? `<button onclick="window.open('${url.replace(/\\/g, "\\\\").replace(/'/g, "\\'").replace(/"/g, "&quot;")}','_blank','noopener,noreferrer')" style="${btnBase}background:transparent;border-color:#E5E0D5;color:#5B5F5C;">${sourceLabel}</button>`
    : "";
  const btnWa = `<button onclick="window.open('${waUrl}','_blank','noopener,noreferrer')" style="${btnBase}background:#0A5C36;border-color:#0A5C36;color:#FFFFFF;">${t.agent}</button>`;
  const sec = precio_cop ? secondary(precio_cop, ctx) : null;

  // Everything is already localized here; data-i18n-skip keeps the DOM walker
  // from re-translating (and caching) the finished strings.
  return `
<div data-i18n-skip style="font-family:system-ui,sans-serif;min-width:220px;max-width:290px;color:#111418;">
  <div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:4px;">${tipoBadge}${inmBadge}</div>
  <div style="color:#6E726E;font-size:11px;margin-bottom:8px;">${escapeHtml(barrio_nombre)}</div>
  ${precio_cop ? `<div style="font-size:18px;font-weight:700;color:#111418;">${money(precio_cop, ctx)}</div>` : ""}
  ${sec ? `<div style="color:#6E726E;font-size:11px;margin-bottom:6px;">${sec}</div>` : ""}
  ${specs ? `<div style="font-size:12px;color:#5B5F5C;margin:6px 0;">${specs}</div>` : ""}
  ${precio_m2 && !isRent ? `<div style="font-size:11px;color:#6E726E;">${t.ppa}/${ctx.unit === "sqft" ? "ft²" : "m²"}: <strong style="color:#111418;">${perArea(precio_m2, ctx)}</strong></div>` : ""}
  ${mediana && !isRent ? `<div style="font-size:11px;color:#6E726E;">${t.median}: <strong style="color:#111418;">${perArea(mediana, ctx)}</strong></div>` : ""}
  ${badgeHTML}
  ${yieldHTML || scoreHTML ? `<div style="margin-top:6px;">${yieldHTML}${scoreHTML}</div>` : ""}
  <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:10px;">${btnSrc}${btnWa}</div>
</div>`;
}
