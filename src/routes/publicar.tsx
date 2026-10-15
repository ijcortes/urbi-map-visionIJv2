import { seo } from "@/lib/seo";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useTrm } from "@/hooks/useTrm";
import { formatMoney } from "@/lib/format";
import { useEffect, useRef, useState } from "react";
import mapboxgl from "mapbox-gl";
import "mapbox-gl/dist/mapbox-gl.css";
import { motion, AnimatePresence } from "framer-motion";
import { API_ENDPOINTS } from "@/config/api";
import { apiFetch, getToken } from "@/lib/apiClient";
import { auth } from "@/lib/auth";
import { MAPBOX_TOKEN } from "@/lib/mapboxToken";
import { ComunidadLayout } from "@/components/comunidad/ComunidadLayout";
import { K as TOKENS } from "@/design/tokens";

export const Route = createFileRoute("/publicar")({
  component: PublicarRoot,
  head: () => seo({ title: "Publica tu inmueble · Medellín Social", description: "Publica tu apartamento, casa o local gratis y llega a compradores e inversionistas en Medellín.", path: "/publicar" }),
});

function PublicarRoot() {
  return (
    <ComunidadLayout>
      <PublicarPage />
    </ComunidadLayout>
  );
}

// ── Design tokens ──────────────────────────────────────────────────────────────
const K = TOKENS;

// ── Types ──────────────────────────────────────────────────────────────────────

type FormData = {
  // Paso 1
  tipo_operacion: string;
  tipo_inmueble: string;
  precio_cop: string;
  tiene_admin: boolean;
  administracion_cop: string;
  // Paso 2
  area_m2: string;
  area_lote_m2: string;
  habitaciones: string;
  banos: string;
  parqueaderos: string;
  estrato: string;
  piso: string;
  nombre_edificio: string;
  antiguedad: string;
  amoblado: string;
  mascotas: string;
  permite_airbnb: string;
  amenidades_int: string[];
  amenidades_ext: string[];
  // Paso 3
  barrio_id: string;
  barrio_nombre: string;
  municipio: string;
  comuna: string;
  direccion: string;
  matricula_inmobiliaria: string;
  cedula_catastral: string;
  lat: number | null;
  lon: number | null;
  descripcion: string;
  tour_url: string;
  video_url: string;
  // Paso legal (declaraciones — "si"|"no"|"")
  en_propiedad_horizontal: string;
  al_dia_administracion: string;
  al_dia_predial: string;
  tiene_hipoteca: string;
  tiene_escritura: string;
  servicios_al_dia: string;
  estado_civil: string;
  es_persona_juridica: string;
  notas_owner: string;
  // Paso contacto
  nombre_contacto: string;
  telefono: string;
  email_contacto: string;
  horario_contacto: string;
  acepta_terminos: boolean;
  acepta_propietario: boolean;
  acepta_comision: boolean;
};

const INITIAL_FORM: FormData = {
  tipo_operacion: "", tipo_inmueble: "", precio_cop: "",
  tiene_admin: false, administracion_cop: "",
  area_m2: "", area_lote_m2: "", habitaciones: "", banos: "",
  parqueaderos: "", estrato: "", piso: "", nombre_edificio: "", antiguedad: "",
  amoblado: "", mascotas: "", permite_airbnb: "no_se",
  amenidades_int: [], amenidades_ext: [],
  barrio_id: "", barrio_nombre: "", municipio: "", comuna: "",
  direccion: "", matricula_inmobiliaria: "", cedula_catastral: "",
  lat: null, lon: null, descripcion: "", tour_url: "", video_url: "",
  en_propiedad_horizontal: "", al_dia_administracion: "", al_dia_predial: "",
  tiene_hipoteca: "", tiene_escritura: "", servicios_al_dia: "",
  estado_civil: "", es_persona_juridica: "", notas_owner: "",
  nombre_contacto: "", telefono: "", email_contacto: "",
  horario_contacto: "", acepta_terminos: false,
  acepta_propietario: false, acepta_comision: false,
};

const STEPS = ["Información básica", "Características", "Ubicación y fotos", "Información legal", "Contacto"];

// ── Option lists ───────────────────────────────────────────────────────────────

const TIPOS_OP = [
  { v: "venta", l: "Venta" },
  { v: "arriendo", l: "Arriendo" },
];
const TIPOS_IN = [
  { v: "apartamento", l: "Apartamento" }, { v: "casa", l: "Casa" },
  { v: "lote", l: "Lote" },
  { v: "local", l: "Local" }, { v: "oficina", l: "Oficina" },
  { v: "bodega", l: "Bodega" }, { v: "otro", l: "Otro" },
];
const HABITAR = ["1", "2", "3", "4", "5+"];
const BANOS   = ["1", "2", "3", "4+"];
const PARQS   = ["0", "1", "2", "3+"];
const ESTRATOS = ["1", "2", "3", "4", "5", "6"];
const ANTIGUEDAD_OPTS = [
  { v: "0-5", l: "0–5 años" }, { v: "5-10", l: "5–10 años" },
  { v: "10-20", l: "10–20 años" }, { v: "+20", l: "+20 años" },
  { v: "remodelado", l: "Remodelado" },
];
const HORARIOS = [
  "Cualquier hora", "Mañanas (8–12)", "Tardes (12–18)", "Noches (18–21)", "Fines de semana",
];
const AMENIDADES_INT = [
  "Balcón/terraza", "Depósito", "Cuarto de servicio", "Estudio",
  "Cocina integral", "Walk-in closet", "Chimenea", "Jacuzzi",
];
const AMENIDADES_EXT = [
  "Piscina", "Gimnasio", "Salón comunal", "Portería 24h",
  "Vigilancia", "CCTV", "Zonas verdes", "Parque infantil",
  "BBQ", "Cancha deportiva",
];

// ── Helpers ────────────────────────────────────────────────────────────────────

function fmtCOP(raw: string): string {
  const n = raw.replace(/\D/g, "");
  if (!n) return "";
  return Number(n).toLocaleString("es-CO");
}

function parseCOP(formatted: string): number {
  return Number(formatted.replace(/\./g, "").replace(/,/g, ""));
}

function toggleArr(arr: string[], val: string): string[] {
  return arr.includes(val) ? arr.filter((x) => x !== val) : [...arr, val];
}

// ── Sub-components ─────────────────────────────────────────────────────────────

// ⓘ con el "por qué" de cada campo — popover al click, cierra al clic afuera.
function InfoDot({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!open) return;
    const close = () => setOpen(false);
    document.addEventListener("click", close);
    return () => document.removeEventListener("click", close);
  }, [open]);
  return (
    <span style={{ position: "relative", display: "inline-flex", verticalAlign: "middle" }}>
      <button
        type="button"
        aria-label="Por qué pedimos esto"
        onClick={(e) => { e.stopPropagation(); setOpen((v) => !v); }}
        style={{
          width: 15, height: 15, borderRadius: "50%", display: "grid", placeItems: "center",
          fontSize: 10, fontWeight: 800, lineHeight: 1, cursor: "pointer",
          border: `1px solid ${open ? K.teal : K.line}`, background: "#fff",
          color: open ? K.teal : K.muted, fontStyle: "italic", fontFamily: "Georgia, serif",
        }}
      >
        i
      </button>
      {open && (
        <span
          onClick={(e) => e.stopPropagation()}
          style={{
            position: "absolute", bottom: "calc(100% + 8px)", left: -8, zIndex: 50,
            width: "min(260px, 72vw)", background: "#111418", color: "rgba(255,255,255,0.86)",
            padding: "10px 12px", borderRadius: 12, fontSize: 11.5, lineHeight: 1.5,
            fontWeight: 400, boxShadow: "0 10px 30px rgba(0,0,0,0.28)",
          }}
        >
          {text}
          <span style={{ position: "absolute", bottom: -6, left: 12, width: 12, height: 6, background: "#111418", clipPath: "polygon(0 0, 100% 0, 50% 100%)" }} />
        </span>
      )}
    </span>
  );
}

function Field({
  label, required, hint, info, children,
}: {
  label: string; required?: boolean; hint?: string; info?: string; children: React.ReactNode;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      <label style={{ fontSize: 13, color: K.muted, fontWeight: 500, display: "inline-flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
        <span>
          {label}
          {required && <span style={{ color: K.coral }}> *</span>}
          {hint && <span style={{ fontWeight: 400, marginLeft: 6 }}>{hint}</span>}
        </span>
        {info && <InfoDot text={info} />}
      </label>
      {children}
    </div>
  );
}

const inputCls = "w-full rounded-lg border px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-[#0F8A4F]/30 focus:border-[#0F8A4F] transition-colors";
const inputStyle = { borderColor: K.line, background: "#fff", color: K.ink };

function Input(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input className={inputCls} style={inputStyle} {...props} />;
}

function Select({ children, ...props }: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select className={inputCls} style={inputStyle} {...props}>
      {children}
    </select>
  );
}

function Chips({
  options, value, onSelect, multi,
}: {
  options: { v: string; l: string }[];
  value: string | string[];
  onSelect: (v: string) => void;
  multi?: boolean;
}) {
  const isActive = (v: string) =>
    multi ? (value as string[]).includes(v) : value === v;
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
      {options.map((o) => (
        <button
          key={o.v}
          type="button"
          onClick={() => onSelect(o.v)}
          style={{
            padding: "7px 16px",
            borderRadius: 999,
            border: `1.5px solid ${isActive(o.v) ? K.teal : K.line}`,
            background: isActive(o.v) ? K.teal : "#fff",
            color: isActive(o.v) ? "#fff" : K.muted,
            fontSize: 13,
            fontWeight: isActive(o.v) ? 700 : 500,
            cursor: "pointer",
            transition: "all 0.12s",
          }}
        >
          {o.l}
        </button>
      ))}
    </div>
  );
}

// ── Location picker ────────────────────────────────────────────────────────────

function LocationPicker({
  lat, lon, onChange,
}: {
  lat: number | null; lon: number | null;
  onChange: (lat: number, lon: number) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef       = useRef<mapboxgl.Map | null>(null);
  const markerRef    = useRef<mapboxgl.Marker | null>(null);
  const [mapError, setMapError] = useState<string | null>(null);

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    try {
      if (!mapboxgl.supported()) {
        setMapError("Tu navegador no soporta mapas WebGL. Ingresa las coordenadas manualmente.");
        return;
      }

      mapboxgl.accessToken = MAPBOX_TOKEN;
      const initLat = lat ?? 6.2442;
      const initLon = lon ?? -75.5812;

      const map = new mapboxgl.Map({
        container: containerRef.current,
        style: "mapbox://styles/mapbox/light-v11",
        center: [initLon, initLat],
        zoom: lat ? 15 : 12,
        attributionControl: false,
      });
      mapRef.current = map;

      map.addControl(new mapboxgl.NavigationControl({ showCompass: false }), "top-right");

      const marker = new mapboxgl.Marker({ draggable: true, color: K.teal })
        .setLngLat([initLon, initLat])
        .addTo(map);
      markerRef.current = marker;

      marker.on("dragend", () => {
        const pos = marker.getLngLat();
        onChange(pos.lat, pos.lng);
      });

      map.on("click", (e) => {
        marker.setLngLat(e.lngLat);
        onChange(e.lngLat.lat, e.lngLat.lng);
      });

      map.on("error", () => {
        setMapError("Error cargando el mapa. Verifica tu conexión.");
      });
    } catch (err) {
      setMapError("No se pudo inicializar el mapa. Ingresa las coordenadas manualmente.");
    }

    return () => {
      if (mapRef.current) { mapRef.current.remove(); mapRef.current = null; }
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  if (mapError) {
    return (
      <div>
        <div
          style={{
            background: "#FFF8F0",
            border: `1px solid ${K.coral}`,
            borderRadius: 10,
            padding: "16px",
            marginBottom: 12,
            fontSize: 13,
            color: K.coral,
          }}
        >
          {mapError}
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
          <Field label="Latitud">
            <input
              className={inputCls}
              style={inputStyle}
              type="number"
              step="0.00001"
              placeholder="6.24220"
              value={lat ?? ""}
              onChange={(e) => {
                const v = parseFloat(e.target.value);
                if (!isNaN(v) && lon !== null) onChange(v, lon);
                else if (!isNaN(v)) onChange(v, -75.5812);
              }}
            />
          </Field>
          <Field label="Longitud">
            <input
              className={inputCls}
              style={inputStyle}
              type="number"
              step="0.00001"
              placeholder="-75.58120"
              value={lon ?? ""}
              onChange={(e) => {
                const v = parseFloat(e.target.value);
                if (!isNaN(v) && lat !== null) onChange(lat, v);
                else if (!isNaN(v)) onChange(6.2442, v);
              }}
            />
          </Field>
        </div>
      </div>
    );
  }

  return (
    <div>
      <div
        ref={containerRef}
        style={{
          width: "100%", height: 340, borderRadius: 12,
          overflow: "hidden", border: `1px solid ${K.line}`,
        }}
      />
      {lat && lon ? (
        <p style={{ fontSize: 12, color: K.teal, marginTop: 6, fontWeight: 600 }}>
          ✓ Ubicación marcada: {lat.toFixed(5)}, {lon.toFixed(5)}
        </p>
      ) : (
        <p style={{ fontSize: 12, color: K.muted, marginTop: 6 }}>
          Haz clic en el mapa o arrastra el pin para marcar la ubicación exacta de la propiedad.
        </p>
      )}
    </div>
  );
}

// ── Photo upload ───────────────────────────────────────────────────────────────

type PhotoEntry = { file: File; preview: string };

function PhotoUpload({
  photos, onChange,
}: {
  photos: PhotoEntry[];
  onChange: (photos: PhotoEntry[]) => void;
}) {
  function handleAdd(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    const toAdd = files
      .filter((f) => photos.length < 20)
      .map((f) => ({ file: f, preview: URL.createObjectURL(f) }));
    onChange([...photos, ...toAdd].slice(0, 20));
    e.target.value = "";
  }

  function remove(idx: number) {
    URL.revokeObjectURL(photos[idx].preview);
    onChange(photos.filter((_, i) => i !== idx));
  }

  function setPrimary(idx: number) {
    const copy = [...photos];
    const [item] = copy.splice(idx, 1);
    onChange([item, ...copy]);
  }

  return (
    <div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 10, marginBottom: 12 }}>
        {photos.map((p, i) => (
          <div
            key={p.preview}
            style={{
              position: "relative",
              width: 100,
              height: 100,
              borderRadius: 10,
              overflow: "hidden",
              border: i === 0 ? `2.5px solid ${K.teal}` : `1px solid ${K.line}`,
            }}
          >
            <img
              src={p.preview}
              alt=""
              style={{ width: "100%", height: "100%", objectFit: "cover" }}
            />
            {i === 0 && (
              <span
                style={{
                  position: "absolute",
                  bottom: 0,
                  left: 0,
                  right: 0,
                  background: K.teal,
                  color: "#fff",
                  fontSize: 9,
                  fontWeight: 700,
                  textAlign: "center",
                  padding: "2px 0",
                }}
              >
                PRINCIPAL
              </span>
            )}
            <button
              type="button"
              onClick={() => remove(i)}
              style={{
                position: "absolute",
                top: 4,
                right: 4,
                background: "rgba(0,0,0,0.55)",
                color: "#fff",
                border: "none",
                borderRadius: "50%",
                width: 20,
                height: 20,
                fontSize: 12,
                cursor: "pointer",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              ×
            </button>
            {i !== 0 && (
              <button
                type="button"
                onClick={() => setPrimary(i)}
                title="Hacer principal"
                style={{
                  position: "absolute",
                  top: 4,
                  left: 4,
                  background: "rgba(0,0,0,0.45)",
                  color: "#fff",
                  border: "none",
                  borderRadius: 4,
                  fontSize: 9,
                  padding: "2px 5px",
                  cursor: "pointer",
                }}
              >
                ★
              </button>
            )}
          </div>
        ))}
        {photos.length < 20 && (
          <label
            style={{
              width: 100,
              height: 100,
              borderRadius: 10,
              border: `2px dashed ${K.line}`,
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              cursor: "pointer",
              gap: 4,
            }}
          >
            <input
              type="file"
              accept="image/jpeg,image/png,image/webp"
              multiple
              className="hidden"
              onChange={handleAdd}
            />
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke={K.muted} strokeWidth="1.5">
              <path d="M12 5v14M5 12h14" />
            </svg>
            <span style={{ fontSize: 10, color: K.muted }}>Agregar</span>
          </label>
        )}
      </div>
      <p style={{ fontSize: 11, color: K.muted }}>
        Máx 20 fotos · JPG, PNG, WebP · 5MB c/u · La primera = foto principal
      </p>
    </div>
  );
}

// ── Step 1 ─────────────────────────────────────────────────────────────────────

function Step1({
  data, setData,
}: {
  data: FormData; setData: (p: Partial<FormData>) => void;
}) {
  const precioCOP = parseCOP(data.precio_cop);
  const { valor: trm } = useTrm();
  const precioUSD = precioCOP && trm ? formatMoney(precioCOP / trm, "USD", "en", { suffix: false }) : null;
  const isArriendo = data.tipo_operacion === "arriendo";

  return (
    <div style={{ display: "grid", gap: 20 }}>
      <Field label="Tipo de operación" required info="Define si tu inmueble se busca para comprar o para arrendar — es el primer filtro que usan los interesados.">
        <Chips
          options={TIPOS_OP}
          value={data.tipo_operacion}
          onSelect={(v) => setData({ tipo_operacion: v })}
        />
      </Field>
      <Field label="Tipo de inmueble" required info="Determina qué compradores lo ven y con qué propiedades se compara para estimar su precio.">
        <Chips
          options={TIPOS_IN}
          value={data.tipo_inmueble}
          onSelect={(v) => setData({ tipo_inmueble: v })}
        />
      </Field>
      <Field
        label={isArriendo ? "Precio mensual COP" : "Precio de venta COP"}
        required
        info="El precio correcto define cuántos interesados llegan. Lo comparamos con inmuebles similares de la zona para ubicar el tuyo en el mapa de precios."
      >
        <div style={{ position: "relative" }}>
          <span
            style={{
              position: "absolute",
              left: 12,
              top: "50%",
              transform: "translateY(-50%)",
              color: K.muted,
              fontSize: 13,
              pointerEvents: "none",
            }}
          >
            $
          </span>
          <input
            className={inputCls}
            style={{ ...inputStyle, paddingLeft: 24 }}
            inputMode="numeric"
            value={data.precio_cop}
            onChange={(e) => setData({ precio_cop: fmtCOP(e.target.value) })}
            placeholder="0"
          />
        </div>
        {precioUSD && (
          <p style={{ fontSize: 12, color: K.teal, marginTop: 4 }}>
            ≈ USD {precioUSD.replace(/^\$/, "")}
          </p>
        )}
      </Field>
      <Field label="¿Tiene cuota de administración mensual?" info="La administración es un costo mensual real en propiedad horizontal. El comprador la suma al precio para saber cuánto le cuesta vivir ahí; el inversionista la resta de su rentabilidad. Todos los portales la piden.">
        <div style={{ display: "flex", gap: 10 }}>
          {[{ l: "No", v: false }, { l: "Sí", v: true }].map((o) => (
            <button
              key={String(o.v)}
              type="button"
              onClick={() => setData({ tiene_admin: o.v })}
              style={{
                flex: 1, padding: "9px", borderRadius: 8,
                border: `1.5px solid ${data.tiene_admin === o.v ? K.teal : K.line}`,
                background: data.tiene_admin === o.v ? K.teal : "#fff",
                color: data.tiene_admin === o.v ? "#fff" : K.muted,
                fontSize: 13, fontWeight: 600, cursor: "pointer",
              }}
            >
              {o.l}
            </button>
          ))}
        </div>
      </Field>
      {data.tiene_admin && (
        <Field label="Cuota de administración mensual COP">
          <div style={{ position: "relative" }}>
            <span style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", color: K.muted, fontSize: 13 }}>$</span>
            <input
              className={inputCls}
              style={{ ...inputStyle, paddingLeft: 24 }}
              inputMode="numeric"
              value={data.administracion_cop}
              onChange={(e) => setData({ administracion_cop: fmtCOP(e.target.value) })}
              placeholder="0"
            />
          </div>
        </Field>
      )}
    </div>
  );
}

// ── Step 2 ─────────────────────────────────────────────────────────────────────

function Step2({
  data, setData,
}: {
  data: FormData; setData: (p: Partial<FormData>) => void;
}) {
  const showLote     = ["lote", "casa", "otro"].includes(data.tipo_inmueble);
  const showHab      = !["lote", "local", "bodega", "oficina"].includes(data.tipo_inmueble);
  const showPiso     = !["lote", "casa"].includes(data.tipo_inmueble);
  const showEdificio = !["lote", "casa", "bodega"].includes(data.tipo_inmueble);
  const esVenta      = data.tipo_operacion === "venta";
  const esArriendo   = data.tipo_operacion === "arriendo";

  return (
    <div style={{ display: "grid", gap: 20 }}>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        <Field label="Área construida m²" info="Es la base del precio por m², la medida con la que comparamos tu inmueble con otros de la zona. Sin ella no se puede estimar bien su valor.">
          <Input inputMode="decimal" value={data.area_m2} onChange={(e) => setData({ area_m2: e.target.value })} placeholder="0" />
        </Field>
        {showLote && (
          <Field label="Área del lote m²" info="En casas y lotes el valor del suelo suele pesar más que lo construido. Clave para tasar bien.">
            <Input inputMode="decimal" value={data.area_lote_m2} onChange={(e) => setData({ area_lote_m2: e.target.value })} placeholder="0" />
          </Field>
        )}
      </div>

      {showHab && (
        <Field label="Habitaciones" info="Uno de los filtros más usados en la búsqueda. Define el tipo de comprador: familia, pareja o inversión.">
          <Chips options={HABITAR.map((v) => ({ v, l: v }))} value={data.habitaciones} onSelect={(v) => setData({ habitaciones: v })} />
        </Field>
      )}

      <Field label="Baños" info="Afecta el precio y el filtro de búsqueda, sobre todo en familias.">
        <Chips options={BANOS.map((v) => ({ v, l: v }))} value={data.banos} onSelect={(v) => setData({ banos: v })} />
      </Field>

      <Field label="Parqueaderos" info="En Medellín suma valor real al inmueble y es de los filtros más frecuentes.">
        <Chips options={PARQS.map((v) => ({ v, l: v }))} value={data.parqueaderos} onSelect={(v) => setData({ parqueaderos: v })} />
      </Field>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        <Field label="Estrato" info="Define servicios públicos, impuestos y el perfil socioeconómico de la zona. Filtro clave para el comprador y para el banco que da el crédito.">
          <Chips options={ESTRATOS.map((v) => ({ v, l: v }))} value={data.estrato} onSelect={(v) => setData({ estrato: v })} />
        </Field>
        {showPiso && (
          <Field label="Piso" info="Un piso alto con vista o uno bajo sin ascensor cambian el valor y el interés. Dato relevante para el comprador.">
            <Input inputMode="numeric" value={data.piso} onChange={(e) => setData({ piso: e.target.value })} placeholder="Ej: 3" />
          </Field>
        )}
      </div>

      {showEdificio && (
        <Field label="Nombre del edificio / conjunto" info="Nos deja agrupar y comparar unidades del mismo edificio, y evitar que el mismo inmueble aparezca duplicado desde varias fuentes.">
          <Input
            value={data.nombre_edificio}
            onChange={(e) => setData({ nombre_edificio: e.target.value })}
            placeholder="Ej: Torres del Poblado, Conjunto Laureles"
          />
        </Field>
      )}

      <Field label="Antigüedad" info="El estado y los años inciden en el precio y en la aprobación del crédito hipotecario.">
        <Select value={data.antiguedad} onChange={(e) => setData({ antiguedad: e.target.value })}>
          <option value="">Seleccionar</option>
          {ANTIGUEDAD_OPTS.map((o) => <option key={o.v} value={o.v}>{o.l}</option>)}
        </Select>
      </Field>

      <Field label="Amoblado" info="Cambia el canon de arriendo y habilita la renta corta o amoblada, que suele valer más.">
        <Chips
          options={[{ v: "si", l: "Amoblado" }, { v: "semi", l: "Semi-amoblado" }, { v: "no", l: "Sin amueblar" }]}
          value={data.amoblado}
          onSelect={(v) => setData({ amoblado: v })}
        />
      </Field>

      <Field label="Características interiores" info="Las amenidades justifican el precio y ayudan a destacar frente a inmuebles similares.">
        <Chips
          options={AMENIDADES_INT.map((v) => ({ v, l: v }))}
          value={data.amenidades_int}
          onSelect={(v) => setData({ amenidades_int: toggleArr(data.amenidades_int, v) })}
          multi
        />
      </Field>

      <Field label="Características externas / zonas comunes" info="Piscina, gimnasio o portería suben el valor percibido y filtran al comprador que busca esas comodidades.">
        <Chips
          options={AMENIDADES_EXT.map((v) => ({ v, l: v }))}
          value={data.amenidades_ext}
          onSelect={(v) => setData({ amenidades_ext: toggleArr(data.amenidades_ext, v) })}
          multi
        />
      </Field>

      {(esArriendo || esVenta) && (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          {esArriendo && (
            <Field label="Mascotas permitidas" info="Es de los primeros filtros de quien arrienda con mascota. Decirlo amplía tu universo de interesados.">
              <Select value={data.mascotas} onChange={(e) => setData({ mascotas: e.target.value })}>
                <option value="">Seleccionar</option>
                <option value="si">Sí</option>
                <option value="no">No</option>
              </Select>
            </Field>
          )}
          {esVenta && (
            <Field label="Permite Airbnb" hint="(potencial renta corta)" info="Señal clave para el comprador-inversionista: saber si el edificio permite renta corta (Airbnb) cambia su decisión y el precio que paga.">
              <Select value={data.permite_airbnb} onChange={(e) => setData({ permite_airbnb: e.target.value })}>
                <option value="si">Sí</option>
                <option value="no">No</option>
                <option value="no_se">No sé</option>
              </Select>
            </Field>
          )}
        </div>
      )}
    </div>
  );
}

// ── Step 3 ─────────────────────────────────────────────────────────────────────

type BarrioOpt = { id: number; nombre: string; municipio: string; comuna: string };

function Step3({
  data, setData, photos, setPhotos,
}: {
  data: FormData;
  setData: (p: Partial<FormData>) => void;
  photos: PhotoEntry[];
  setPhotos: (p: PhotoEntry[]) => void;
}) {
  const [barrios, setBarrios] = useState<BarrioOpt[]>([]);
  const [loadingBarrios, setLoadingBarrios] = useState(false);

  useEffect(() => {
    setLoadingBarrios(true);
    fetch(API_ENDPOINTS.listingsPropiosBarriosForm)
      .then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
      .then((resp) => { if (Array.isArray(resp)) setBarrios(resp); })
      .catch(() => {})
      .finally(() => setLoadingBarrios(false));
  }, []);

  const municipios = [...new Set(barrios.map((b) => b.municipio))].sort();
  const comunas = data.municipio
    ? [...new Set(barrios.filter((b) => b.municipio === data.municipio).map((b) => b.comuna))].sort()
    : [];
  const barriosFiltrados = data.municipio && data.comuna
    ? barrios.filter((b) => b.municipio === data.municipio && b.comuna === data.comuna)
    : [];

  return (
    <div style={{ display: "grid", gap: 20 }}>
      <div>
        <h3 style={{ fontFamily: K.serif, fontSize: "1rem", color: K.ink, fontWeight: 700, marginBottom: 16 }}>
          Ubicación
        </h3>
        <div style={{ display: "grid", gap: 12 }}>
          <Field label="Municipio" required info="Ubica tu inmueble en el mapa y lo compara con los precios reales de su zona.">
            <Select
              value={data.municipio}
              onChange={(e) => setData({ municipio: e.target.value, comuna: "", barrio_id: "", barrio_nombre: "" })}
              disabled={loadingBarrios}
            >
              <option value="">Seleccionar municipio</option>
              {municipios.map((m) => <option key={m} value={m}>{m}</option>)}
            </Select>
          </Field>

          {data.municipio && (
            <Field label="Comuna / Sector" required info="Afina la ubicación y el grupo de inmuebles con el que se compara el tuyo.">
              <Select
                value={data.comuna}
                onChange={(e) => setData({ comuna: e.target.value, barrio_id: "", barrio_nombre: "" })}
              >
                <option value="">Seleccionar comuna</option>
                {comunas.map((c) => <option key={c} value={c}>{c}</option>)}
              </Select>
            </Field>
          )}

          {data.comuna && (
            <Field label="Barrio" required info="El barrio define el precio de referencia y la seguridad y servicios que evalúa el comprador.">
              <Select
                value={data.barrio_id}
                onChange={(e) => {
                  const opt = barriosFiltrados.find((b) => String(b.id) === e.target.value);
                  setData({ barrio_id: e.target.value, barrio_nombre: opt?.nombre ?? "" });
                }}
              >
                <option value="">Seleccionar barrio</option>
                {barriosFiltrados.map((b) => <option data-i18n-skip key={b.id} value={b.id}>{b.nombre}</option>)}
              </Select>
            </Field>
          )}

          <Field label="Dirección exacta" required hint="(privada — no se muestra en el mapa público)" info="No se publica en el mapa. La usamos para identificar tu inmueble sin duplicarlo y construir su historial exacto — buscamos la base de datos más completa de cada propiedad de la ciudad.">
            <Input
              value={data.direccion}
              onChange={(e) => setData({ direccion: e.target.value })}
              placeholder="Ej: Carrera 35 #10A-25, apto 502"
            />
          </Field>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <Field label="Matrícula inmobiliaria" hint="(opcional · en la escritura)" info="Es la cédula del inmueble en el registro público (ORIP). Nos deja seguir la MISMA propiedad entre portales y en el tiempo, sin confundirla con otra.">
              <Input
                value={data.matricula_inmobiliaria}
                onChange={(e) => setData({ matricula_inmobiliaria: e.target.value })}
                placeholder="Ej: 001-123456"
              />
            </Field>
            <Field label="Cédula catastral / CBML" hint="(opcional · en el predial)" info="Identifica el predio en catastro. Conecta tu inmueble con su avalúo, predial y datos oficiales.">
              <Input
                value={data.cedula_catastral}
                onChange={(e) => setData({ cedula_catastral: e.target.value })}
                placeholder="Ej: 14080010001"
              />
            </Field>
          </div>
        </div>
      </div>

      <div>
        <h3 style={{ fontFamily: K.serif, fontSize: "1rem", color: K.ink, fontWeight: 700, marginBottom: 8, display: "flex", alignItems: "center", gap: 8 }}>
          <span>Ubicación en el mapa <span style={{ color: K.coral, fontSize: 12 }}>*</span></span>
          <InfoDot text="El pin fija el punto exacto para mostrar tu inmueble en el lugar correcto del mapa (al público se muestra aproximado). También ayuda a no duplicarlo con otros avisos." />
        </h3>
        <p style={{ fontSize: 13, color: K.muted, marginBottom: 12 }}>
          Haz clic en el mapa o arrastra el pin para marcar la ubicación exacta de la propiedad.
        </p>
        <LocationPicker
          lat={data.lat}
          lon={data.lon}
          onChange={(lat, lon) => setData({ lat, lon })}
        />
      </div>

      <div>
        <h3 style={{ fontFamily: K.serif, fontSize: "1rem", color: K.ink, fontWeight: 700, marginBottom: 12, display: "flex", alignItems: "center", gap: 8 }}>
          <span>Fotos</span>
          <InfoDot text="La primera foto es la portada. Más y mejores fotos = más clics y más contactos; es lo que más mueve una publicación." />
        </h3>
        <PhotoUpload photos={photos} onChange={setPhotos} />
      </div>

      <Field label="Descripción" required info="Es tu argumento de venta. Más detalle genera más confianza y más contactos de interesados serios.">
        <textarea
          className="w-full rounded-lg border px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-[#0F8A4F]/30 focus:border-[#0F8A4F] transition-colors resize-none"
          style={{ borderColor: K.line, color: K.ink, minHeight: 100 }}
          value={data.descripcion}
          onChange={(e) => setData({ descripcion: e.target.value })}
          placeholder="Describe las características principales, el estado del inmueble, qué hace especial esta propiedad…"
          rows={4}
        />
        <p style={{ fontSize: 11, color: data.descripcion.length < 50 ? K.muted : K.teal }}>
          {data.descripcion.length}/50 caracteres mínimo
        </p>
      </Field>

      <Field label="Tour 3D / 360° (opcional)" info="Los inmuebles con tour reciben muchas más visitas y filtran curiosos — llegan interesados más decididos.">
        <input
          type="url"
          className="w-full rounded-lg border px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-[#0F8A4F]/30 focus:border-[#0F8A4F] transition-colors"
          style={{ borderColor: K.line, color: K.ink }}
          value={data.tour_url}
          onChange={(e) => setData({ tour_url: e.target.value })}
          placeholder="https://my.matterport.com/show/?m=…  ·  kuula.co/share/…"
        />
        <p style={{ fontSize: 11, color: K.muted }}>
          Pega el link de tu tour Matterport, Kuula, CloudPano, iStaging o Ricoh360.
        </p>
      </Field>

      <Field label="Video (opcional)" info="Un video corto aumenta los clics y el tiempo de atención sobre tu publicación.">
        <input
          type="url"
          className="w-full rounded-lg border px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-[#0F8A4F]/30 focus:border-[#0F8A4F] transition-colors"
          style={{ borderColor: K.line, color: K.ink }}
          value={data.video_url}
          onChange={(e) => setData({ video_url: e.target.value })}
          placeholder="https://youtube.com/watch?v=…  ·  vimeo.com/…"
        />
      </Field>
    </div>
  );
}

// ── Step Legal ───────────────────────────────────────────────────────────────
// Espejo de api/schemas/intake_cuestionario.py. Venta = set legal completo;
// arriendo = liviano. Las respuestas van a listing.declaraciones (autoreporte,
// no verificado). El realtor asignado las verifica en due diligence.

const SI_NO = [{ v: "si", l: "Sí" }, { v: "no", l: "No" }];

function BoolQuestion({
  label, required, info, value, onSelect,
}: {
  label: string; required?: boolean; info?: string; value: string; onSelect: (v: string) => void;
}) {
  return (
    <Field label={label} required={required} info={info}>
      <Chips options={SI_NO} value={value} onSelect={onSelect} />
    </Field>
  );
}

function StepLegal({
  data, setData,
}: {
  data: FormData; setData: (p: Partial<FormData>) => void;
}) {
  const esVenta = data.tipo_operacion === "venta";
  const esPH = data.en_propiedad_horizontal === "si";

  return (
    <div style={{ display: "grid", gap: 20 }}>
      <div
        style={{
          background: K.surface,
          border: `1px solid ${K.line}`,
          borderRadius: 12,
          padding: "14px 16px",
        }}
      >
        <p style={{ fontSize: 13, color: K.ink, lineHeight: 1.6 }}>
          Esta información es <strong>obligatoria</strong> y ayuda a que un asesor
          verifique tu propiedad más rápido. Es un autoreporte: no se publica
          públicamente, la revisa el asesor asignado.
        </p>
      </div>

      {esVenta ? (
        <>
          <BoolQuestion
            label="¿Es propiedad horizontal (edificio/condominio)?"
            required
            info="Define si hay administración y reglamento de copropiedad — afecta trámites y costos de la venta."
            value={data.en_propiedad_horizontal}
            onSelect={(v) => setData({ en_propiedad_horizontal: v })}
          />
          {esPH && (
            <BoolQuestion
              label="¿Al día con la administración?"
              required
              info="Un comprador no quiere heredar deudas de administración; estar al día agiliza el cierre."
              value={data.al_dia_administracion}
              onSelect={(v) => setData({ al_dia_administracion: v })}
            />
          )}
          <BoolQuestion
            label="¿Al día con el impuesto predial?"
            required
            info="Las deudas de predial se trasladan con el inmueble; estar al día acelera la venta."
            value={data.al_dia_predial}
            onSelect={(v) => setData({ al_dia_predial: v })}
          />
          <BoolQuestion
            label="¿Tiene hipoteca?"
            required
            info="Si hay hipoteca, hay que levantarla en la venta; el asesor lo prepara con tiempo."
            value={data.tiene_hipoteca}
            onSelect={(v) => setData({ tiene_hipoteca: v })}
          />
          <BoolQuestion
            label="¿Tiene escritura pública?"
            required
            info="Sin escritura clara no hay venta. Confirma que el título está listo para transferir."
            value={data.tiene_escritura}
            onSelect={(v) => setData({ tiene_escritura: v })}
          />
          <BoolQuestion
            label="¿Servicios al día (agua, luz, gas)?"
            required
            info="Servicios al día evitan sorpresas y trámites pendientes en el cierre."
            value={data.servicios_al_dia}
            onSelect={(v) => setData({ servicios_al_dia: v })}
          />
          <Field label="Estado civil del propietario" info="En Colombia el estado civil define quién debe firmar la venta (sociedad conyugal). Evita trabas al cerrar.">
            <Select value={data.estado_civil} onChange={(e) => setData({ estado_civil: e.target.value })}>
              <option value="">Seleccionar</option>
              {["Soltero/a", "Casado/a", "Unión libre", "Divorciado/a", "Viudo/a"].map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </Select>
          </Field>
          <BoolQuestion
            label="¿Es persona jurídica / empresa?"
            info="Si el dueño es una empresa, los documentos y el proceso de venta cambian."
            value={data.es_persona_juridica}
            onSelect={(v) => setData({ es_persona_juridica: v })}
          />
        </>
      ) : (
        <BoolQuestion
          label="¿Servicios al día (agua, luz, gas)?"
          info="El arrendatario necesita recibir el inmueble con los servicios activos y al día."
          value={data.servicios_al_dia}
          onSelect={(v) => setData({ servicios_al_dia: v })}
        />
      )}

      <Field label="Notas adicionales" info="Cualquier detalle que le ahorre tiempo al asesor en la verificación de tu propiedad.">
        <textarea
          className={inputCls}
          style={{ ...inputStyle, minHeight: 80, resize: "vertical" }}
          value={data.notas_owner}
          onChange={(e) => setData({ notas_owner: e.target.value })}
          placeholder="Cualquier detalle relevante para el asesor (opcional)"
        />
      </Field>
    </div>
  );
}

// ── Verificación de teléfono (OTP) — requisito para publicar sin ser agente ────

function OtpTelefono({ telefono }: { telefono: string }) {
  const [fase, setFase] = useState<"idle" | "enviado" | "ok">("idle");
  const [codigo, setCodigo] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const enviar = async () => {
    if (!telefono.trim()) { setErr("Escribe tu teléfono primero"); return; }
    setBusy(true); setErr(null);
    try {
      await apiFetch(API_ENDPOINTS.listingsPropiosOtpEnviar, {
        method: "POST", body: JSON.stringify({ telefono }),
      });
      setFase("enviado");
    } catch {
      setErr("No se pudo enviar el código. Intenta de nuevo.");
    } finally { setBusy(false); }
  };

  const confirmar = async () => {
    setBusy(true); setErr(null);
    try {
      await apiFetch(API_ENDPOINTS.listingsPropiosOtpConfirmar, {
        method: "POST", body: JSON.stringify({ codigo }),
      });
      setFase("ok");
    } catch (e) {
      setErr(e instanceof Error && e.message ? e.message : "Código inválido o vencido");
    } finally { setBusy(false); }
  };

  if (fase === "ok") {
    return (
      <p style={{ fontSize: 13, color: K.teal, fontWeight: 600, marginTop: -8 }}>
        ✓ Teléfono verificado
      </p>
    );
  }

  return (
    <div style={{ marginTop: -8, display: "grid", gap: 8 }}>
      {fase === "idle" ? (
        <button
          type="button"
          onClick={enviar}
          disabled={busy}
          style={{
            justifySelf: "start", padding: "8px 14px", borderRadius: 8, fontSize: 13,
            fontWeight: 600, border: `1px solid ${K.teal}`, color: K.tealDeep,
            background: "transparent", cursor: "pointer", opacity: busy ? 0.6 : 1,
          }}
        >
          {busy ? "Enviando…" : "Verificar teléfono"}
        </button>
      ) : (
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <Input
            inputMode="numeric"
            value={codigo}
            onChange={(e) => setCodigo(e.target.value)}
            placeholder="Código de 6 dígitos"
            style={{ maxWidth: 180 }}
          />
          <button
            type="button"
            onClick={confirmar}
            disabled={busy || codigo.length < 4}
            style={{
              padding: "8px 14px", borderRadius: 8, fontSize: 13, fontWeight: 600,
              border: "none", color: "#fff", background: K.teal, cursor: "pointer",
              opacity: busy || codigo.length < 4 ? 0.6 : 1,
            }}
          >
            {busy ? "Verificando…" : "Confirmar"}
          </button>
          <button type="button" onClick={enviar} disabled={busy} style={{ fontSize: 12, color: K.muted, background: "none", border: "none", cursor: "pointer" }}>
            Reenviar
          </button>
        </div>
      )}
      {fase === "enviado" && !err && (
        <p style={{ fontSize: 12, color: K.muted }}>Te enviamos el código a tu correo. Vence en 10 minutos.</p>
      )}
      {err && <p style={{ fontSize: 12, color: K.coral }}>{err}</p>}
    </div>
  );
}

// ── Step 4 ─────────────────────────────────────────────────────────────────────

function Step4({
  data, setData, esAgente,
}: {
  data: FormData; setData: (p: Partial<FormData>) => void; esAgente: boolean;
}) {
  const esVenta = data.tipo_operacion === "venta";

  return (
    <div style={{ display: "grid", gap: 20 }}>
      <Field label="Nombre completo" required info="Para que el asesor y los interesados sepan con quién están hablando.">
        <Input
          value={data.nombre_contacto}
          onChange={(e) => setData({ nombre_contacto: e.target.value })}
          placeholder="Tu nombre"
        />
      </Field>
      <Field label="Teléfono / WhatsApp" required info="Es el canal principal: la mayoría de interesados escribe por WhatsApp. Sin él no te pueden contactar.">
        <Input
          inputMode="tel"
          value={data.telefono}
          onChange={(e) => setData({ telefono: e.target.value })}
          placeholder="+57 300 000 0000"
        />
      </Field>
      {!esAgente && <OtpTelefono telefono={data.telefono} />}
      <Field label="Email de contacto" info="Respaldo de contacto y medio para enviarte el estado de tu publicación.">
        <Input
          type="email"
          value={data.email_contacto}
          onChange={(e) => setData({ email_contacto: e.target.value })}
          placeholder="correo@ejemplo.com"
        />
      </Field>
      <Field label="Horario de contacto preferido" info="Evita llamadas en mal momento y mejora la tasa de respuesta a los interesados.">
        <Select value={data.horario_contacto} onChange={(e) => setData({ horario_contacto: e.target.value })}>
          <option value="">Seleccionar</option>
          {HORARIOS.map((h) => <option key={h} value={h}>{h}</option>)}
        </Select>
      </Field>

      {esVenta && (
        <div
          style={{
            background: K.tealLight,
            border: `1px solid ${K.teal}`,
            borderRadius: 12,
            padding: "18px 16px",
          }}
        >
          <p style={{ fontSize: 13, fontWeight: 700, color: K.tealDeep, marginBottom: 8 }}>
            💡 Sobre la comisión de venta
          </p>
          <p style={{ fontSize: 13, color: K.ink, lineHeight: 1.6, marginBottom: 10 }}>
            Al vender a través de Medellín Social:
          </p>
          <div style={{ display: "grid", gap: 4 }}>
            {[
              "2% para el agente que cierra",
              "1% para la plataforma",
              "Total: 3% sobre el precio de venta",
            ].map((l) => (
              <p key={l} style={{ fontSize: 13, color: K.ink, paddingLeft: 16, position: "relative" }}>
                <span style={{ position: "absolute", left: 0, color: K.teal }}>•</span>
                {l}
              </p>
            ))}
          </div>
          <p style={{ fontSize: 12, color: K.muted, marginTop: 10 }}>
            Solo se cobra cuando se cierra la venta. Sin costos por publicar.
          </p>
        </div>
      )}

      {!esAgente && (
        <div
          style={{
            background: K.surface,
            border: `1px solid ${K.line}`,
            borderRadius: 12,
            padding: "16px",
          }}
        >
          <p style={{ fontSize: 13, fontWeight: 700, color: K.ink, marginBottom: 6 }}>
            ¿Quieres más visibilidad?
          </p>
          <p style={{ fontSize: 13, color: K.muted, lineHeight: 1.6 }}>
            Conecta con un agente verificado para llegar a más compradores e
            inversores extranjeros.{" "}
            <Link to="/real-estate" style={{ color: K.teal, fontWeight: 600 }}>
              Ver agentes →
            </Link>
          </p>
        </div>
      )}

      <div style={{ display: "grid", gap: 10 }}>
        {[
          {
            key: "acepta_terminos" as const,
            label: "Acepto los términos y condiciones de Medellín Social",
          },
          {
            key: "acepta_propietario" as const,
            label: "Confirmo que soy el propietario o tengo autorización para publicar esta propiedad",
          },
          ...(esVenta
            ? [{
                key: "acepta_comision" as const,
                label: "Acepto el modelo de comisión del 3% sobre el precio de venta (solo aplica si se cierra la venta)",
              }]
            : []),
        ].map(({ key, label }) => (
          <label
            key={key}
            style={{
              display: "flex",
              gap: 12,
              alignItems: "flex-start",
              cursor: "pointer",
              padding: "10px 14px",
              borderRadius: 8,
              border: `1.5px solid ${data[key] ? K.teal : K.line}`,
              background: data[key] ? K.tealLight : "#fff",
            }}
          >
            <input
              type="checkbox"
              checked={data[key] as boolean}
              onChange={(e) => setData({ [key]: e.target.checked })}
              style={{ marginTop: 2, accentColor: K.teal, flexShrink: 0 }}
            />
            <span style={{ fontSize: 13, color: K.ink, lineHeight: 1.5 }}>{label}</span>
          </label>
        ))}
      </div>
    </div>
  );
}

// ── Success screens ────────────────────────────────────────────────────────────

function SuccessAgente({ listingId }: { listingId: string }) {
  return (
    <div style={{ textAlign: "center", padding: "48px 24px", maxWidth: 480, margin: "0 auto" }}>
      <div style={{ fontSize: 52, marginBottom: 16 }}>✅</div>
      <h2 style={{ fontFamily: K.serif, color: K.ink, fontSize: "1.5rem", fontWeight: 800, marginBottom: 12 }}>
        Tu propiedad está activa en el MLS
      </h2>
      <p style={{ color: K.muted, fontSize: 14, lineHeight: 1.7, marginBottom: 28 }}>
        Ya aparece en el mapa de Medellín Social con tu badge de agente verificado.
      </p>
      <div style={{ display: "flex", gap: 12, justifyContent: "center", flexWrap: "wrap" }}>
        <Link
          to="/map"
          style={{
            background: K.teal, color: "#fff", padding: "11px 24px",
            borderRadius: 8, fontWeight: 700, fontSize: 13, textDecoration: "none",
          }}
        >
          Ver en el mapa →
        </Link>
        <Link
          to="/publicar"
          style={{
            background: "#fff", color: K.teal, padding: "11px 24px",
            borderRadius: 8, fontWeight: 700, fontSize: 13, textDecoration: "none",
            border: `1.5px solid ${K.teal}`,
          }}
          onClick={() => window.location.reload()}
        >
          Publicar otra →
        </Link>
      </div>
    </div>
  );
}

function SuccessPropietario({ listingId }: { listingId: string }) {
  return (
    <div style={{ textAlign: "center", padding: "48px 24px", maxWidth: 480, margin: "0 auto" }}>
      <div style={{ fontSize: 52, marginBottom: 16 }}>🕐</div>
      <h2 style={{ fontFamily: K.serif, color: K.ink, fontSize: "1.5rem", fontWeight: 800, marginBottom: 12 }}>
        Tu propiedad está en revisión
      </h2>
      <p style={{ color: K.muted, fontSize: 14, lineHeight: 1.7, marginBottom: 20 }}>
        Nuestro equipo verificará las fotos y los datos antes de publicarla en el mapa.
        Recibirás un email cuando esté activa, normalmente en <strong>menos de 24 horas</strong>.
      </p>
      <div
        style={{
          background: K.tealLight,
          border: `1px solid ${K.teal}`,
          borderRadius: 12,
          padding: "16px",
          marginBottom: 28,
          textAlign: "left",
        }}
      >
        <p style={{ fontSize: 13, fontWeight: 700, color: K.tealDeep, marginBottom: 6 }}>
          Conecta con un agente verificado
        </p>
        <p style={{ fontSize: 13, color: K.ink, lineHeight: 1.6, marginBottom: 10 }}>
          Un agente te ayudará a llegar a más compradores e inversores. Tu propiedad se activa de inmediato.
        </p>
        <Link
          to="/conectar-agente"
          search={{ listing_id: listingId }}
          style={{
            display: "inline-block",
            background: K.teal, color: "#fff",
            padding: "9px 18px",
            borderRadius: 6, fontWeight: 700, fontSize: 12, textDecoration: "none",
          }}
        >
          Conectar con agente →
        </Link>
      </div>
      <Link
        to="/mis-propiedades"
        style={{ display: "inline-block", color: K.teal, fontSize: 13, fontWeight: 700, textDecoration: "none" }}
      >
        Ver mis propiedades →
      </Link>
    </div>
  );
}

// ── Not logged in screen ────────────────────────────────────────────────────────

function NotLoggedIn() {
  return (
    <div style={{ textAlign: "center", padding: "64px 24px", maxWidth: 520, margin: "0 auto" }}>
      <h2 style={{ fontFamily: K.serif, color: K.ink, fontSize: "1.5rem", fontWeight: 800, marginBottom: 12 }}>
        ¿Cómo quieres publicar?
      </h2>
      <p style={{ color: K.muted, fontSize: 14, lineHeight: 1.7, marginBottom: 32 }}>
        Crea una cuenta o inicia sesión para publicar tu propiedad en el MLS de Medellín Social.
      </p>
      <div style={{ display: "grid", gap: 16 }}>
        <Link
          to="/register"
          onClick={() => localStorage.setItem("registro_origen", "mls")}
          style={{
            display: "block",
            background: "#fff",
            border: `2px solid ${K.line}`,
            borderRadius: 12,
            padding: "20px 24px",
            textDecoration: "none",
            textAlign: "left",
          }}
        >
          <p style={{ fontSize: 13, fontWeight: 700, color: K.ink, marginBottom: 4 }}>
            Soy propietario — Publicar gratis
          </p>
          <p style={{ fontSize: 13, color: K.muted }}>
            Publica directamente sin intermediarios. Sin costo.
          </p>
        </Link>
        <Link
          to="/conectar-agente"
          search={{ listing_id: "" }}
          style={{
            display: "block",
            background: K.tealDeep,
            borderRadius: 12,
            padding: "20px 24px",
            textDecoration: "none",
            textAlign: "left",
          }}
        >
          <p style={{ fontSize: 13, fontWeight: 700, color: "#fff", marginBottom: 4 }}>
            Soy agente verificado — Publicar destacado
          </p>
          <p style={{ fontSize: 13, color: "rgba(255,255,255,0.7)" }}>
            Listing activo inmediatamente con badge de agente.
          </p>
        </Link>
        <p style={{ fontSize: 13, color: K.muted }}>
          ¿Ya tienes cuenta?{" "}
          <Link to="/login" style={{ color: K.teal, fontWeight: 600 }}>
            Inicia sesión →
          </Link>
        </p>
      </div>
    </div>
  );
}

// ── Stepper indicator ──────────────────────────────────────────────────────────

function StepperBar({ step }: { step: number }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 0, marginBottom: 32 }}>
      {STEPS.map((label, i) => {
        const done    = i < step;
        const current = i === step;
        return (
          <div key={label} style={{ display: "flex", alignItems: "center", flex: i < STEPS.length - 1 ? 1 : "none" }}>
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", flexShrink: 0 }}>
              <div
                style={{
                  width: 28, height: 28, borderRadius: "50%",
                  background: done ? K.teal : current ? K.tealDeep : K.line,
                  color: done || current ? "#fff" : K.muted,
                  display: "flex", alignItems: "center", justifyContent: "center",
                  fontSize: 12, fontWeight: 700,
                  border: current ? `2px solid ${K.teal}` : "none",
                }}
              >
                {done ? "✓" : i + 1}
              </div>
              <span
                style={{
                  fontSize: 10, marginTop: 4,
                  color: current ? K.tealDeep : done ? K.teal : K.muted,
                  fontWeight: current ? 700 : 500,
                  whiteSpace: "normal",
                  maxWidth: 70,
                  textAlign: "center",
                  lineHeight: 1.2,
                }}
              >
                {label}
              </span>
            </div>
            {i < STEPS.length - 1 && (
              <div
                style={{
                  height: 2, flex: 1, marginBottom: 16,
                  background: done ? K.teal : K.line,
                  transition: "background 0.2s",
                }}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}

// ── Validation ─────────────────────────────────────────────────────────────────

function validateStep(step: number, data: FormData): string | null {
  if (step === 0) {
    if (!data.tipo_operacion) return "Selecciona el tipo de operación";
    if (!data.tipo_inmueble) return "Selecciona el tipo de inmueble";
    if (!data.precio_cop) return "Ingresa el precio";
    if (parseCOP(data.precio_cop) < 100000) return "El precio parece muy bajo";
  }
  if (step === 2) {
    if (!data.direccion.trim()) return "Ingresa la dirección exacta del inmueble";
    if (!data.lat || !data.lon) return "Marca la ubicación en el mapa";
    if (data.descripcion.length < 50) return "La descripción debe tener al menos 50 caracteres";
  }
  if (step === 3) {
    // Declaraciones legales obligatorias (espejo del cuestionario backend).
    const esVenta = data.tipo_operacion === "venta";
    if (esVenta) {
      if (!data.en_propiedad_horizontal) return "Indica si es propiedad horizontal";
      if (data.en_propiedad_horizontal === "si" && !data.al_dia_administracion)
        return "Indica si está al día con la administración";
      if (!data.al_dia_predial) return "Indica si está al día con el predial";
      if (!data.tiene_hipoteca) return "Indica si tiene hipoteca";
      if (!data.tiene_escritura) return "Indica si tiene escritura pública";
      if (!data.servicios_al_dia) return "Indica si los servicios están al día";
    }
  }
  if (step === 4) {
    if (!data.nombre_contacto.trim()) return "Ingresa tu nombre";
    if (!data.telefono.trim()) return "Ingresa tu teléfono";
    if (!data.acepta_terminos) return "Debes aceptar los términos y condiciones";
    if (!data.acepta_propietario) return "Debes confirmar que eres propietario o tienes autorización";
    const esVenta = data.tipo_operacion === "venta";
    if (esVenta && !data.acepta_comision) return "Debes aceptar el modelo de comisión";
  }
  return null;
}

// ── Main page ──────────────────────────────────────────────────────────────────

function PublicarPage() {
  const navigate  = useNavigate();
  const user      = typeof window !== "undefined" ? auth.get() : null;
  const [step, setStep]       = useState(0);
  const [form, setFormRaw]    = useState<FormData>(INITIAL_FORM);
  const [photos, setPhotos]   = useState<PhotoEntry[]>([]);
  const [error, setError]     = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [done, setDone]       = useState<{ id: string; es_agente: boolean } | null>(null);
  const [esAgente, setEsAgente] = useState(false);

  const setData = (p: Partial<FormData>) => setFormRaw((f) => ({ ...f, ...p }));

  // Fetch agente status once logged in
  useEffect(() => {
    if (!user) return;
    if (!getToken()) return;
    apiFetch<{ es_agente?: boolean; nombre?: string; email?: string }>(API_ENDPOINTS.listingsPropiosMe)
      .then((d) => {
        setEsAgente(d.es_agente ?? false);
        if (d.nombre) setData({ nombre_contacto: d.nombre });
        if (d.email)  setData({ email_contacto: d.email });
      })
      .catch(() => {});
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  if (!user) return <NotLoggedIn />;
  if (done) {
    return done.es_agente
      ? <SuccessAgente listingId={done.id} />
      : <SuccessPropietario listingId={done.id} />;
  }

  const next = () => {
    const err = validateStep(step, form);
    if (err) { setError(err); return; }
    if (step === 2 && photos.length === 0) { setError("Agrega al menos una foto de la propiedad"); return; }
    setError(null);
    setStep((s) => Math.min(s + 1, STEPS.length - 1));
  };

  const prev = () => { setError(null); setStep((s) => Math.max(s - 1, 0)); };

  const submit = async () => {
    const err = validateStep(step, form);
    if (err) { setError(err); return; }
    setLoading(true);
    setError(null);

    try {
      const fd = new FormData();
      const cop = parseCOP(form.precio_cop);
      fd.append("tipo_operacion",    form.tipo_operacion);
      fd.append("tipo_inmueble",     form.tipo_inmueble);
      fd.append("precio_cop",        String(cop));
      if (form.tiene_admin && form.administracion_cop)
        fd.append("administracion_cop", String(parseCOP(form.administracion_cop)));
      if (form.area_m2)     fd.append("area_m2",      form.area_m2);
      if (form.area_lote_m2) fd.append("area_lote_m2", form.area_lote_m2);
      if (form.habitaciones) fd.append("habitaciones", form.habitaciones === "5+" ? "5" : form.habitaciones);
      if (form.banos)        fd.append("banos",        form.banos === "4+" ? "4" : form.banos);
      if (form.parqueaderos) fd.append("parqueaderos", form.parqueaderos === "3+" ? "3" : form.parqueaderos);
      if (form.estrato)           fd.append("estrato",           form.estrato);
      if (form.piso)              fd.append("piso",              form.piso);
      if (form.nombre_edificio)   fd.append("nombre_edificio",   form.nombre_edificio);
      if (form.antiguedad)        fd.append("antiguedad",        form.antiguedad);
      if (form.amoblado)     fd.append("amoblado",     form.amoblado === "si" ? "true" : "false");
      const amenidades = [...form.amenidades_int, ...form.amenidades_ext];
      if (amenidades.length) fd.append("amenidades", JSON.stringify(amenidades));
      fd.append("mascotas",       form.mascotas);
      fd.append("permite_airbnb", form.permite_airbnb);
      if (form.barrio_id)  fd.append("barrio_id",  form.barrio_id);
      if (form.direccion)  fd.append("direccion",  form.direccion);
      if (form.matricula_inmobiliaria.trim()) fd.append("matricula_inmobiliaria", form.matricula_inmobiliaria.trim());
      if (form.cedula_catastral.trim())        fd.append("cedula_catastral",        form.cedula_catastral.trim());
      if (form.lat != null) fd.append("lat", String(form.lat));
      if (form.lon != null) fd.append("lon", String(form.lon));
      if (form.descripcion) fd.append("descripcion", form.descripcion);
      if (form.tour_url)  fd.append("tour_url",  form.tour_url.trim());
      if (form.video_url) fd.append("video_url", form.video_url.trim());
      if (form.nombre_contacto) fd.append("nombre_contacto", form.nombre_contacto);
      if (form.telefono)        fd.append("telefono",        form.telefono);
      if (form.email_contacto)  fd.append("email_contacto",  form.email_contacto);
      if (form.horario_contacto) fd.append("horario_contacto", form.horario_contacto);
      fd.append("acepta_terminos",    String(form.acepta_terminos));
      fd.append("acepta_propietario", String(form.acepta_propietario));
      if (form.acepta_comision) fd.append("acepta_comision", "true");

      // Declaraciones legales → JSON (booleans; strings/null para el resto).
      const b = (v: string) => (v === "si" ? true : v === "no" ? false : null);
      const declaraciones: Record<string, unknown> = {
        al_dia_predial:          b(form.al_dia_predial),
        tiene_hipoteca:          b(form.tiene_hipoteca),
        tiene_escritura:         b(form.tiene_escritura),
        servicios_al_dia:        b(form.servicios_al_dia),
        en_propiedad_horizontal: b(form.en_propiedad_horizontal),
        al_dia_administracion:   b(form.al_dia_administracion),
        es_persona_juridica:     b(form.es_persona_juridica),
        estado_civil:            form.estado_civil || null,
        notas_owner:             form.notas_owner || null,
      };
      fd.append("declaraciones", JSON.stringify(declaraciones));

      for (const p of photos) {
        fd.append("fotos", p.file);
      }

      const token = getToken();
      const headers: Record<string, string> = {};
      if (token) headers["Authorization"] = `Bearer ${token}`;

      const res = await fetch(API_ENDPOINTS.listingsPropios, {
        method: "POST",
        headers,
        body: fd,
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error((body as { detail?: string }).detail ?? `Error ${res.status}`);
      }

      const result = await res.json() as { id: string; es_agente: boolean };
      setDone(result);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Error al publicar. Intenta de nuevo.";
      setError(
        msg === "telefono_no_verificado"
          ? "Verifica tu teléfono en el paso de contacto antes de publicar."
          : msg,
      );
    } finally {
      setLoading(false);
    }
  };

  const stepProps = { data: form, setData };

  return (
    <div style={{ background: K.paper, minHeight: "100dvh", padding: "0 0 60px" }}>
      {/* Header */}
      <div
        style={{
          background: K.tealDeep,
          padding: "24px",
          marginBottom: 0,
        }}
      >
        <div style={{ maxWidth: 700, margin: "0 auto" }}>
          <button
            onClick={() => navigate({ to: "/vender" })}
            style={{
              background: "none", border: "none",
              color: "rgba(255,255,255,0.65)", fontSize: 13,
              cursor: "pointer", padding: 0, marginBottom: 8, display: "flex", alignItems: "center", gap: 6,
            }}
          >
            ← Volver
          </button>
          <h1 style={{ fontFamily: K.serif, color: "#fff", fontSize: "1.5rem", fontWeight: 800, margin: 0 }}>
            Publicar propiedad
            {esAgente && (
              <span
                style={{
                  marginLeft: 10,
                  background: "#FCD116",
                  color: K.ink,
                  fontSize: 10,
                  fontWeight: 800,
                  padding: "3px 8px",
                  borderRadius: 999,
                  verticalAlign: "middle",
                }}
              >
                AGENTE VERIFICADO
              </span>
            )}
          </h1>
        </div>
      </div>

      {/* Form card */}
      <div style={{ maxWidth: 700, margin: "0 auto", padding: "32px 24px" }}>
        <StepperBar step={step} />

        {!esAgente && user?.plan !== "pro" && user?.plan !== "agente" && (
          <div
            style={{
              marginBottom: 20,
              padding: "16px 20px",
              background: K.tealLight,
              border: `1.5px solid rgba(29,158,117,0.3)`,
              borderRadius: 12,
              display: "flex",
              gap: 16,
              alignItems: "flex-start",
              flexWrap: "wrap",
            }}
          >
            <div style={{ flex: 1, minWidth: 200 }}>
              <p
                style={{
                  fontFamily: K.serif,
                  fontSize: "0.95rem",
                  fontWeight: 800,
                  color: K.tealDeep,
                  margin: "0 0 6px",
                }}
              >
                Vendé más rápido con MLS Pro
              </p>
              <p style={{ fontSize: 12, color: K.muted, margin: 0, lineHeight: 1.6 }}>
                Análisis de tiempo de venta por barrio, posicionamiento para
                inversores extranjeros y comparador Airbnb vs renta larga.
              </p>
            </div>
            <Link
              to="/planes"
              style={{
                display: "inline-block",
                background: K.tealDeep,
                color: "#fff",
                padding: "9px 18px",
                borderRadius: 8,
                fontWeight: 700,
                fontSize: 13,
                textDecoration: "none",
                flexShrink: 0,
                alignSelf: "center",
              }}
            >
              Ver planes Pro →
            </Link>
          </div>
        )}

        <div
          style={{
            background: "#fff",
            border: `1px solid ${K.line}`,
            borderRadius: 16,
            padding: "28px 24px",
            boxShadow: "0 2px 8px rgba(0,0,0,0.04)",
          }}
        >
          <h2
            style={{
              fontFamily: K.serif,
              color: K.ink,
              fontSize: "1.15rem",
              fontWeight: 800,
              marginBottom: 24,
            }}
          >
            Paso {step + 1}: {STEPS[step]}
          </h2>

          <AnimatePresence mode="wait">
            <motion.div
              key={step}
              initial={{ opacity: 0, x: 12 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -12 }}
              transition={{ duration: 0.18 }}
            >
              {step === 0 && <Step1 {...stepProps} />}
              {step === 1 && <Step2 {...stepProps} />}
              {step === 2 && (
                <Step3
                  {...stepProps}
                  photos={photos}
                  setPhotos={setPhotos}
                />
              )}
              {step === 3 && <StepLegal {...stepProps} />}
              {step === 4 && (
                <Step4 {...stepProps} esAgente={esAgente} />
              )}
            </motion.div>
          </AnimatePresence>

          {error && (
            <div
              style={{
                marginTop: 20,
                background: K.coralLight,
                border: `1px solid ${K.coral}`,
                borderRadius: 8,
                padding: "12px 16px",
                fontSize: 13,
                color: K.coral,
                fontWeight: 500,
              }}
            >
              {error}
            </div>
          )}

          <div
            style={{
              display: "flex",
              gap: 12,
              marginTop: 28,
              justifyContent: "space-between",
            }}
          >
            <button
              type="button"
              onClick={prev}
              disabled={step === 0}
              style={{
                padding: "11px 24px",
                borderRadius: 8,
                border: `1.5px solid ${K.line}`,
                background: "#fff",
                color: step === 0 ? K.line : K.muted,
                fontSize: 13,
                fontWeight: 600,
                cursor: step === 0 ? "default" : "pointer",
              }}
            >
              ← Anterior
            </button>

            {step < STEPS.length - 1 ? (
              <button
                type="button"
                onClick={next}
                style={{
                  padding: "11px 28px",
                  borderRadius: 8,
                  background: K.teal,
                  color: "#fff",
                  border: "none",
                  fontSize: 13,
                  fontWeight: 700,
                  cursor: "pointer",
                }}
              >
                Siguiente →
              </button>
            ) : (
              <button
                type="button"
                onClick={submit}
                disabled={loading}
                style={{
                  padding: "11px 28px",
                  borderRadius: 8,
                  background: loading ? K.muted : K.coral,
                  color: "#fff",
                  border: "none",
                  fontSize: 13,
                  fontWeight: 700,
                  cursor: loading ? "default" : "pointer",
                }}
              >
                {loading ? "Publicando…" : "Publicar propiedad →"}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
