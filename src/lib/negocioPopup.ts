import { safeHttpUrl } from "@/lib/safeUrl";

export interface NegocioPopupStyle {
  ink: string;
  tealDeep: string;
  amarillo: string;
  muted: string;
  coral: string;
  coralLight: string;
}

/**
 * Builds the local-business map popup with DOM APIs only (textContent / property
 * assignment). `nombre`, `direccion`, `categoria`, `website`, `foto_url` are
 * user-editable via POST /mi-negocio, so nothing here may touch innerHTML.
 */
export function buildNegocioPopupContent(
  p: Record<string, unknown>,
  K: NegocioPopupStyle,
): HTMLElement {
  const el = <T extends keyof HTMLElementTagNameMap>(
    tag: T,
    style?: string,
    text?: string,
  ): HTMLElementTagNameMap[T] => {
    const n = document.createElement(tag);
    if (style) n.setAttribute("style", style);
    if (text !== undefined) n.textContent = text;
    return n;
  };
  const pill = (label: string, href: string, style: string) => {
    const a = el("a", style, label);
    a.href = href;
    a.target = "_blank";
    a.rel = "noopener noreferrer";
    return a;
  };

  const root = el("div", "font-family:system-ui;padding:2px");

  const foto = safeHttpUrl(p.foto_url);
  if (foto) {
    const img = el("img", "width:100%;height:60px;object-fit:cover;border-radius:8px;margin-bottom:6px");
    img.src = foto;
    img.alt = String(p.nombre ?? "");
    root.appendChild(img);
  }
  root.appendChild(el("strong", `font-size:.82rem;line-height:1.25;color:${K.ink}`, String(p.nombre ?? "")));
  if (p.categoria) {
    root.appendChild(
      el("div", `font-size:.62rem;color:${K.tealDeep};font-weight:700;text-transform:uppercase;margin:2px 0`, String(p.categoria)),
    );
  }
  if (p.rating_google && Number.isFinite(Number(p.rating_google))) {
    root.appendChild(el("div", `color:${K.amarillo};font-size:.75rem`, `★ ${Number(p.rating_google).toFixed(1)}`));
  }
  if (p.direccion) {
    root.appendChild(
      el("div", `font-size:.66rem;color:${K.muted};margin-top:3px;line-height:1.3`, String(p.direccion)),
    );
  }

  const row = el("div", "display:flex;gap:5px;margin-top:6px;flex-wrap:wrap");
  const pillBase = "padding:3px 8px;border-radius:999px;text-decoration:none;font-size:.62rem;font-weight:700";

  const wa = String(p.whatsapp || p.telefono || "").replace(/\D/g, "");
  if (wa) row.appendChild(pill("💬 WA", `https://wa.me/${wa}`, `background:#25D366;color:#fff;${pillBase}`));

  const lat = Number(p.lat);
  const lon = Number(p.lon);
  const mapsUrl = p.google_place_id
    ? `https://www.google.com/maps/place/?q=place_id:${encodeURIComponent(String(p.google_place_id))}`
    : `https://www.google.com/maps/search/?api=1&query=${Number.isFinite(lat) ? lat : ""},${Number.isFinite(lon) ? lon : ""}`;
  row.appendChild(pill("📍 Maps", mapsUrl, `background:#4285F4;color:#fff;${pillBase}`));

  const web = safeHttpUrl(p.website);
  if (web) row.appendChild(pill("🌐 Web", web, `background:${K.coralLight};color:${K.coral};${pillBase}`));

  root.appendChild(row);
  return root;
}
