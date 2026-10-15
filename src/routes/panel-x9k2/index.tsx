import { Name } from "@/lib/i18n";
import { seo } from "@/lib/seo";
import { createFileRoute, redirect, useNavigate } from "@tanstack/react-router";
import { formatMoney } from "@/lib/format";
import { useEffect, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Users, ShieldCheck, LayoutDashboard, Eye, Heart, Calculator, GitCompare, Check, X, Ban,
  Building2, CreditCard, MapPinned, Plus, Trash2, ClipboardList, Star, Lock, KeyRound,
  UserSearch, ShieldAlert, Activity, Store, Search, ChevronLeft, ChevronRight,
} from "@/lib/icons";
import {
  ResponsiveContainer, LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip, LabelList,
} from "recharts";
import { apiFetch, getToken } from "@/lib/apiClient";
import { adminGateErrorKind } from "@/lib/adminGate";
import { API_ENDPOINTS } from "@/config/api";
import { auth } from "@/lib/auth";
import { toast } from "sonner";
import { K as TOKENS } from "@/design/tokens";

// Ruta ofuscada (no /admin). El gate real es el backend (ADMIN_EMAIL); esto solo
// evita descubrimiento casual. beforeLoad exige sesión; los datos 403 si no eres admin.
// El gate de verdad vive en 3 capas server-side (ver SeguridadTab más abajo):
// 1) require_admin (email allowlist + JWT) 2) audit log inmutable 3) re-auth por
// password en mutaciones críticas. El redirect de AdminPanel es UX, no seguridad.
export const Route = createFileRoute("/panel-x9k2/")({
  head: () => seo({ title: "Admin · Medellín Social", description: "Panel de administración.", noindex: true }),
  beforeLoad: () => {
    if (typeof window === "undefined") return;
    if (!localStorage.getItem("medellin-social.user") || !getToken()) throw redirect({ to: "/login" });
  },
  component: AdminPanel,
});

const K = TOKENS;

type Tab = "overview" | "usuarios" | "leads" | "listings" | "realtors" | "eventos" | "negocios" | "seguridad";
const TABS: { id: Tab; label: string; Icon: typeof Users }[] = [
  { id: "overview",  label: "Resumen",   Icon: LayoutDashboard },
  { id: "usuarios",  label: "Usuarios",  Icon: Users },
  { id: "leads",     label: "Leads",     Icon: UserSearch },
  { id: "listings",  label: "Listings",  Icon: ClipboardList },
  { id: "realtors",  label: "Realtors",  Icon: ShieldCheck },
  { id: "eventos",   label: "Eventos",   Icon: Star },
  { id: "negocios",  label: "Negocios",  Icon: Store },
  { id: "seguridad", label: "Seguridad", Icon: ShieldAlert },
];

function AdminPanel() {
  const [tab, setTab] = useState<Tab>("overview");
  const navigate = useNavigate();
  // Gate de UI: una sola consulta arriba decide si se muestra el panel entero.
  // No es una capa de seguridad (el backend ya rechaza con 403 sin esto) — solo
  // evita que un usuario no-admin vea la estructura de tabs antes del rechazo.
  const gate = useQuery<Dashboard>({
    queryKey: ["admin", "dashboard"],
    queryFn: () => apiFetch<Dashboard>(API_ENDPOINTS.adminDashboard),
    retry: false,
  });
  const errMsg = gate.error ? String((gate.error as Error).message) : "";
  const kind = adminGateErrorKind(errMsg);
  useEffect(() => {
    if (kind === "login") navigate({ to: "/login" });
    else if (kind === "forbidden") navigate({ to: "/" });
  }, [kind, navigate]);

  if (gate.isLoading) return <div style={{ background: K.paper, minHeight: "100dvh" }} />;
  if (gate.error) {
    // Never a blank page: redirecting states say so, anything else shows the reason.
    return (
      <div role="alert" style={{ background: K.paper, minHeight: "100dvh", display: "grid", placeItems: "center", padding: 24 }}>
        <div style={{ maxWidth: 420, textAlign: "center", color: K.ink }}>
          <h1 className="text-lg font-bold" style={{ fontFamily: K.serif }}>
            {kind === "login" ? "Inicia sesión para continuar" : kind === "forbidden" ? "No autorizado" : "No se pudo cargar el panel"}
          </h1>
          <p className="mt-2 text-sm" style={{ color: K.muted }}>
            {kind === "other" ? errMsg : "Redirigiendo…"}
          </p>
          {kind === "other" && (
            <button onClick={() => gate.refetch()} className="mt-4 rounded-md border px-3 py-1.5 text-sm" style={{ borderColor: K.line }}>
              Reintentar
            </button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div style={{ background: K.paper, minHeight: "100dvh" }}>
      <header className="border-b" style={{ borderColor: K.line, background: "#FFFFFF" }}>
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-4">
          <h1 className="text-xl font-bold" style={{ fontFamily: K.serif, color: K.ink }}>Panel de administración</h1>
          <span className="text-xs" style={{ color: K.muted }}>{auth.get()?.email}</span>
        </div>
        <div className="mx-auto flex max-w-6xl gap-6 overflow-x-auto px-4">
          {TABS.map(({ id, label, Icon }) => (
            <button key={id} onClick={() => setTab(id)}
              className="flex shrink-0 items-center gap-1.5 border-b-2 pb-2.5 pt-1 text-sm transition"
              style={tab === id ? { borderColor: K.teal, color: K.ink, fontWeight: 600 } : { borderColor: "transparent", color: K.muted }}>
              <Icon className="h-4 w-4" /> {label}
            </button>
          ))}
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-8">
        {tab === "overview"  && <OverviewTab data={gate.data} />}
        {tab === "usuarios"  && <UsuariosTab />}
        {tab === "leads"     && <LeadsTab />}
        {tab === "listings"  && <ListingsTab />}
        {tab === "realtors"  && <RealtorsTab />}
        {tab === "eventos"   && <EventosTab />}
        {tab === "negocios"  && <NegociosTab />}
        {tab === "seguridad" && <SeguridadTab />}
      </main>
    </div>
  );
}

function AccessError({ error }: { error: unknown }) {
  const msg = String((error as Error)?.message ?? "");
  if (/403|no autorizado/i.test(msg))
    return <p className="text-sm" style={{ color: K.coral }}>Acceso solo para administradores.</p>;
  return <p className="text-sm" style={{ color: K.coral }}>No se pudo cargar. {msg}</p>;
}

function Kpi({ icon, value, label, accent }: { icon: React.ReactNode; value: number | string; label: string; accent?: string }) {
  return (
    <div className="rounded-xl border p-4" style={{ borderColor: K.line, background: "#FFFFFF" }}>
      <div className="mb-1" style={{ color: accent ?? K.muted }}>{icon}</div>
      <div className="text-2xl font-bold" style={{ color: K.ink, fontFamily: K.serif }}>{value}</div>
      <div className="text-xs" style={{ color: K.muted }}>{label}</div>
    </div>
  );
}

// ── Re-auth por password (capa 3) ──────────────────────────────────────────────
// Acciones que otorgan o revocan acceso pagado (cambiar plan, activar/desactivar
// usuario, aprobar/suspender agente) piden la contraseña del admin de nuevo antes
// de ejecutarse. Un token robado ya-adentro no puede escalar acceso en silencio.
function usePasswordPrompt() {
  const [pending, setPending] = useState<{ resolve: (pw: string) => void; reject: () => void; label: string } | null>(null);
  const ask = (label: string) =>
    new Promise<string>((resolve, reject) => setPending({ resolve, reject, label }));
  const modal = pending ? (
    <PasswordModal label={pending.label}
      onConfirm={(pw) => { pending.resolve(pw); setPending(null); }}
      onCancel={() => { pending.reject(); setPending(null); }} />
  ) : null;
  return { ask, modal };
}

function PasswordModal({ label, onConfirm, onCancel }: { label: string; onConfirm: (pw: string) => void; onCancel: () => void }) {
  const [pw, setPw] = useState("");
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: "rgba(20,32,29,0.45)" }}>
      <div className="w-full max-w-sm rounded-xl border p-5" style={{ borderColor: K.line, background: "#FFFFFF" }}>
        <div className="mb-3 flex items-center gap-2" style={{ color: K.tealDeep }}>
          <Lock className="h-4 w-4" />
          <span className="text-sm font-semibold">Confirma tu contraseña</span>
        </div>
        <p className="mb-3 text-xs" style={{ color: K.muted }}>{label}</p>
        <input
          type="password" autoFocus value={pw} onChange={(e) => setPw(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && pw) onConfirm(pw); if (e.key === "Escape") onCancel(); }}
          placeholder="Tu contraseña de admin"
          className="mb-3 w-full rounded-md border px-3 py-2 text-sm"
          style={{ borderColor: K.line, color: K.ink }}
        />
        <div className="flex justify-end gap-2">
          <button onClick={onCancel} className="rounded-lg px-3 py-1.5 text-xs font-medium" style={{ color: K.muted }}>Cancelar</button>
          <button onClick={() => pw && onConfirm(pw)} disabled={!pw}
            className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50"
            style={{ background: K.tealDeep }}>
            <KeyRound className="h-3.5 w-3.5" /> Confirmar
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Gráficas — un solo hue por gráfica (job = magnitud/tendencia, no identidad) ─
const chartTick = { fontSize: 11, fill: K.muted };

function ChartCard({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border p-4" style={{ borderColor: K.line, background: "#FFFFFF" }}>
      <div className="mb-3">
        <div className="text-sm font-semibold" style={{ color: K.ink }}>{title}</div>
        {subtitle && <div className="text-xs" style={{ color: K.muted }}>{subtitle}</div>}
      </div>
      {children}
    </div>
  );
}

function ChartTooltip({ active, payload, label, suffix }: { active?: boolean; payload?: { value: number }[]; label?: string; suffix?: string }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg border px-3 py-2 text-xs shadow-sm" style={{ borderColor: K.line, background: "#FFFFFF" }}>
      <div style={{ color: K.muted }}>{label}</div>
      <div className="font-semibold" style={{ color: K.ink }}>{payload[0].value.toLocaleString("es-CO")}{suffix ?? ""}</div>
    </div>
  );
}

function TrendLine({ data, xKey, yKey, suffix }: { data: Record<string, unknown>[]; xKey: string; yKey: string; suffix?: string }) {
  return (
    <ResponsiveContainer width="100%" height={200}>
      <LineChart data={data} margin={{ top: 8, right: 8, left: -20, bottom: 0 }}>
        <CartesianGrid stroke={K.line} vertical={false} />
        <XAxis dataKey={xKey} tick={chartTick} axisLine={{ stroke: K.line }} tickLine={false}
          tickFormatter={(v: string) => v.slice(5)} interval="preserveStartEnd" />
        <YAxis tick={chartTick} axisLine={false} tickLine={false} width={36} allowDecimals={false} />
        <Tooltip content={<ChartTooltip suffix={suffix} />} />
        <Line type="monotone" dataKey={yKey} stroke={K.teal} strokeWidth={2}
          strokeLinecap="round" strokeLinejoin="round" dot={false} activeDot={{ r: 4, fill: K.teal, stroke: "#FFFFFF", strokeWidth: 2 }} />
      </LineChart>
    </ResponsiveContainer>
  );
}

function TrendBars({ data, xKey, yKey, suffix }: { data: Record<string, unknown>[]; xKey: string; yKey: string; suffix?: string }) {
  return (
    <ResponsiveContainer width="100%" height={200}>
      <BarChart data={data} margin={{ top: 8, right: 8, left: -20, bottom: 0 }}>
        <CartesianGrid stroke={K.line} vertical={false} />
        <XAxis dataKey={xKey} tick={chartTick} axisLine={{ stroke: K.line }} tickLine={false}
          tickFormatter={(v: string) => v.slice(5)} interval="preserveStartEnd" />
        <YAxis tick={chartTick} axisLine={false} tickLine={false} width={36} allowDecimals={false} />
        <Tooltip content={<ChartTooltip suffix={suffix} />} cursor={{ fill: K.surface }} />
        <Bar dataKey={yKey} fill={K.teal} radius={[4, 4, 0, 0]} maxBarSize={22} />
      </BarChart>
    </ResponsiveContainer>
  );
}

function RankBars({ items, height }: { items: { label: string; value: number }[]; height?: number }) {
  return (
    <ResponsiveContainer width="100%" height={height ?? Math.max(120, items.length * 34)}>
      <BarChart data={items} layout="vertical" margin={{ top: 4, right: 28, left: 0, bottom: 4 }}>
        <XAxis type="number" hide />
        <YAxis type="category" dataKey="label" tick={chartTick} axisLine={false} tickLine={false} width={110} />
        <Tooltip content={<ChartTooltip />} cursor={{ fill: K.surface }} />
        <Bar dataKey="value" fill={K.teal} radius={[0, 4, 4, 0]} maxBarSize={18}>
          <LabelList dataKey="value" position="right" style={{ fill: K.muted, fontSize: 11 }} />
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

// ── Overview ─────────────────────────────────────────────────────────────────
type Dashboard = {
  negocio: {
    realtors: Record<string, number>;
    listings: Record<string, number>;
    suscripciones: Record<string, number>;
    sponsorships_activos: number;
  };
  usuarios: { total: number; activos_7dias: number; activos_30dias: number; nuevos_hoy: number; nuevos_7dias: number; nuevos_30dias: number };
  perfiles: {
    por_objetivo: Record<string, number>;
    por_riesgo: Record<string, number>;
    por_presupuesto: Record<string, number>;
  };
  comportamiento: { total_simulaciones: number; total_comparaciones: number; total_vistas_barrio: number; total_favoritos: number; barrios_top10: { nombre: string; visitas: number }[]; municipios_top5: { municipio: string; visitas: number }[] };
  registros_por_dia: { fecha: string; count: number }[];
  actividad_por_dia: { fecha: string; acciones: number }[];
};

const LABELS_OBJETIVO: Record<string, string> = {
  airbnb: "Airbnb / renta corta", nomadas: "Nómadas digitales", mediano_plazo: "Mediano plazo",
  largo_plazo: "Largo plazo", mixto: "Mixto",
};
const LABELS_RIESGO: Record<string, string> = { conservador: "Conservador", moderado: "Moderado", agresivo: "Agresivo" };
const LABELS_PRESUPUESTO: Record<string, string> = {
  menos_200M: "< $200M", "200M_500M": "$200M – 500M", "500M_1000M": "$500M – 1.000M", mas_1000M: "> $1.000M",
};
const toRankItems = (rec: Record<string, number>, labels: Record<string, string>) =>
  Object.entries(rec).filter(([, v]) => v > 0).map(([k, v]) => ({ label: labels[k] ?? k, value: v }));

function OverviewTab({ data }: { data?: Dashboard }) {
  if (!data) return <p className="text-sm" style={{ color: K.muted }}>Cargando…</p>;
  const { usuarios: u, comportamiento: c, negocio: n, perfiles: p, registros_por_dia, actividad_por_dia } = data;
  const subsTotal = Object.values(n.suscripciones).reduce((s, x) => s + x, 0);
  return (
    <div className="space-y-6">
      <div>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider" style={{ color: K.muted }}>Negocio</h2>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Kpi icon={<ShieldCheck className="h-4 w-4" />} accent={K.teal} value={n.realtors.activo ?? 0} label={`realtors activos (${n.realtors.pendiente ?? 0} pend.)`} />
          <Kpi icon={<CreditCard className="h-4 w-4" />} accent={K.fucsia} value={subsTotal} label={`suscripciones (${n.suscripciones.pro ?? 0} pro · ${n.suscripciones.agente ?? 0} agente)`} />
          <Kpi icon={<Building2 className="h-4 w-4" />} value={n.listings.publicado ?? 0} label={`listings publicados (${n.listings.en_revision ?? 0} en revisión)`} />
          <Kpi icon={<MapPinned className="h-4 w-4" />} value={n.sponsorships_activos} label="zonas patrocinadas activas" />
        </div>
      </div>
      <div>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider" style={{ color: K.muted }}>Usuarios</h2>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          <Kpi icon={<Users className="h-4 w-4" />} value={u.total} label="total" />
          <Kpi icon={<Users className="h-4 w-4" />} value={u.activos_7dias} label="activos 7d" />
          <Kpi icon={<Users className="h-4 w-4" />} value={u.activos_30dias} label="activos 30d" />
          <Kpi icon={<Users className="h-4 w-4" />} value={u.nuevos_hoy} label="nuevos hoy" />
          <Kpi icon={<Users className="h-4 w-4" />} value={u.nuevos_7dias} label="nuevos 7d" />
          <Kpi icon={<Users className="h-4 w-4" />} value={u.nuevos_30dias} label="nuevos 30d" />
        </div>
      </div>
      <div>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider" style={{ color: K.muted }}>Actividad</h2>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Kpi icon={<Calculator className="h-4 w-4" />} value={c.total_simulaciones} label="simulaciones" />
          <Kpi icon={<GitCompare className="h-4 w-4" />} value={c.total_comparaciones} label="comparaciones" />
          <Kpi icon={<Eye className="h-4 w-4" />} value={c.total_vistas_barrio} label="vistas barrio" />
          <Kpi icon={<Heart className="h-4 w-4" />} value={c.total_favoritos} label="favoritos" />
        </div>
      </div>

      <div>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider" style={{ color: K.muted }}>Crecimiento</h2>
        <div className="grid gap-3 sm:grid-cols-2">
          <ChartCard title="Registros nuevos" subtitle="Últimos 30 días">
            {registros_por_dia?.length ? <TrendLine data={registros_por_dia} xKey="fecha" yKey="count" suffix=" registros" />
              : <p className="text-xs" style={{ color: K.muted }}>Sin registros en el rango.</p>}
          </ChartCard>
          <ChartCard title="Acciones de usuarios" subtitle="Últimos 14 días · simulaciones + comparaciones + vistas">
            {actividad_por_dia?.length ? <TrendBars data={actividad_por_dia} xKey="fecha" yKey="acciones" suffix=" acciones" />
              : <p className="text-xs" style={{ color: K.muted }}>Sin actividad en el rango.</p>}
          </ChartCard>
        </div>
      </div>

      <div>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider" style={{ color: K.muted }}>Perfiles de inversión</h2>
        <div className="grid gap-3 sm:grid-cols-3">
          <ChartCard title="Objetivo">
            {toRankItems(p.por_objetivo, LABELS_OBJETIVO).length
              ? <RankBars items={toRankItems(p.por_objetivo, LABELS_OBJETIVO)} />
              : <p className="text-xs" style={{ color: K.muted }}>Sin datos.</p>}
          </ChartCard>
          <ChartCard title="Perfil de riesgo">
            {toRankItems(p.por_riesgo, LABELS_RIESGO).length
              ? <RankBars items={toRankItems(p.por_riesgo, LABELS_RIESGO)} />
              : <p className="text-xs" style={{ color: K.muted }}>Sin datos.</p>}
          </ChartCard>
          <ChartCard title="Presupuesto">
            {toRankItems(p.por_presupuesto, LABELS_PRESUPUESTO).length
              ? <RankBars items={toRankItems(p.por_presupuesto, LABELS_PRESUPUESTO)} />
              : <p className="text-xs" style={{ color: K.muted }}>Sin datos.</p>}
          </ChartCard>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        {c.barrios_top10?.length > 0 && (
          <div>
            <h2 className="mb-2 text-sm font-semibold uppercase tracking-wider" style={{ color: K.muted }}>Barrios más vistos</h2>
            <div className="rounded-xl border" style={{ borderColor: K.line, background: "#FFFFFF" }}>
              {c.barrios_top10.slice(0, 8).map((b, i) => (
                <div key={i} className="flex items-center justify-between border-b px-4 py-2 text-sm last:border-0" style={{ borderColor: K.line }}>
                  <span style={{ color: K.ink }}>{i + 1}. <Name>{b.nombre}</Name></span>
                  <span style={{ color: K.muted }}>{b.visitas} vistas</span>
                </div>
              ))}
            </div>
          </div>
        )}
        {c.municipios_top5?.length > 0 && (
          <ChartCard title="Municipios más vistos">
            <RankBars items={c.municipios_top5.map((m) => ({ label: m.municipio, value: m.visitas }))} />
          </ChartCard>
        )}
      </div>
    </div>
  );
}

// ── Listings en revisión ──────────────────────────────────────────────────────
type ListingRevision = {
  id: string;
  tipo_operacion: string;
  tipo_inmueble: string;
  precio_cop: number;
  barrio: string | null;
  municipio: string | null;
  nombre_contacto: string | null;
  telefono: string | null;
  email_contacto: string | null;
  created_at: string;
  fotos: string[] | null;
};

const fmtCOP = (n: number) =>
  formatMoney(n, "COP", "es", { suffix: false });

function ListingsTab() {
  const qc = useQueryClient();
  const [motivoAbierto, setMotivoAbierto] = useState<string | null>(null);
  const [motivo, setMotivo] = useState("");

  const { data, isLoading, error } = useQuery<ListingRevision[]>({
    queryKey: ["admin", "listings-revision"],
    queryFn: () => apiFetch<ListingRevision[]>(API_ENDPOINTS.adminListingsEnRevision),
  });

  const aprobar = useMutation({
    mutationFn: (id: string) => apiFetch<void>(API_ENDPOINTS.adminListingAprobar(id), { method: "POST" }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["admin", "listings-revision"] }); qc.invalidateQueries({ queryKey: ["admin", "dashboard"] }); toast.success("Listing publicado"); },
    onError: () => toast.error("No se pudo aprobar"),
  });

  const rechazar = useMutation({
    mutationFn: ({ id, mot }: { id: string; mot: string }) =>
      apiFetch<void>(API_ENDPOINTS.adminListingRechazar(id), { method: "POST", body: JSON.stringify({ motivo: mot }) }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["admin", "listings-revision"] }); qc.invalidateQueries({ queryKey: ["admin", "dashboard"] }); setMotivoAbierto(null); setMotivo(""); toast.success("Listing rechazado"); },
    onError: () => toast.error("No se pudo rechazar"),
  });

  if (isLoading) return <p className="text-sm" style={{ color: K.muted }}>Cargando…</p>;
  if (error) return <AccessError error={error} />;
  if (!data?.length) return <p className="text-sm" style={{ color: K.muted }}>Sin listings pendientes de revisión. ✓</p>;

  return (
    <div className="space-y-4">
      <p className="text-sm" style={{ color: K.muted }}>{data.length} listing{data.length !== 1 ? "s" : ""} en revisión</p>
      {data.map((l) => (
        <div key={l.id} className="rounded-xl border" style={{ borderColor: K.line, background: "#FFFFFF" }}>
          {/* Fotos */}
          {l.fotos && l.fotos.length > 0 && (
            <div className="flex gap-2 overflow-x-auto p-3 pb-0">
              {l.fotos.slice(0, 5).map((url, i) => (
                <img key={i} src={url} alt="" style={{ height: 100, width: 140, objectFit: "cover", borderRadius: 8, flexShrink: 0 }} />
              ))}
            </div>
          )}
          {(!l.fotos || l.fotos.length === 0) && (
            <div className="p-3 pb-0">
              <div className="flex h-24 items-center justify-center rounded-lg" style={{ background: K.surface }}>
                <span className="text-xs" style={{ color: K.muted }}>Sin fotos</span>
              </div>
            </div>
          )}
          {/* Info */}
          <div className="flex flex-wrap items-start justify-between gap-3 p-3">
            <div className="min-w-0 space-y-0.5">
              <div className="font-semibold capitalize" style={{ color: K.ink }}>
                {l.tipo_inmueble} en {l.tipo_operacion} · {fmtCOP(l.precio_cop)}
              </div>
              <div className="text-xs" style={{ color: K.muted }}>
                {[l.barrio, l.municipio].filter(Boolean).join(", ")}
              </div>
              <div className="text-xs" style={{ color: K.muted }}>
                {l.nombre_contacto && <span>{l.nombre_contacto} · </span>}
                {l.telefono && <span>{l.telefono} · </span>}
                {l.email_contacto && <span>{l.email_contacto}</span>}
              </div>
              <div className="text-[11px]" style={{ color: K.muted }}>
                {new Date(l.created_at).toLocaleString("es-CO", { dateStyle: "short", timeStyle: "short" })}
              </div>
            </div>
            <div className="flex flex-col gap-2">
              <button
                onClick={() => aprobar.mutate(l.id)}
                disabled={aprobar.isPending}
                className="inline-flex items-center gap-1.5 rounded-lg px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
                style={{ background: K.teal }}
              >
                <Check className="h-4 w-4" /> Aprobar
              </button>
              {motivoAbierto === l.id ? (
                <div className="flex flex-col gap-1.5">
                  <textarea
                    value={motivo}
                    onChange={(e) => setMotivo(e.target.value)}
                    placeholder="Motivo del rechazo…"
                    rows={2}
                    className="rounded-md border px-2 py-1.5 text-xs"
                    style={{ borderColor: K.coral, color: K.ink, resize: "none", minWidth: 200 }}
                  />
                  <div className="flex gap-1.5">
                    <button
                      onClick={() => motivo.trim() && rechazar.mutate({ id: l.id, mot: motivo.trim() })}
                      disabled={!motivo.trim() || rechazar.isPending}
                      className="inline-flex items-center gap-1 rounded-lg px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50"
                      style={{ background: K.coral }}
                    >
                      <X className="h-3.5 w-3.5" /> Confirmar rechazo
                    </button>
                    <button onClick={() => { setMotivoAbierto(null); setMotivo(""); }}
                      className="text-xs" style={{ color: K.muted }}>Cancelar</button>
                  </div>
                </div>
              ) : (
                <button
                  onClick={() => setMotivoAbierto(l.id)}
                  className="inline-flex items-center gap-1.5 rounded-lg border px-4 py-2 text-sm font-semibold"
                  style={{ borderColor: K.coral, color: K.coral }}
                >
                  <X className="h-4 w-4" /> Rechazar
                </button>
              )}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

// ── Realtors ─────────────────────────────────────────────────────────────────
type Agente = { id: string; email: string; nombre: string; telefono: string | null; estado: string; created_at: string };
const ESTADOS = [
  { id: "pendiente", label: "Pendientes" },
  { id: "activo", label: "Activos" },
  { id: "rechazado", label: "Rechazados" },
  { id: "inactivo", label: "Inactivos" },
];

function RealtorsTab() {
  const qc = useQueryClient();
  const [estado, setEstado] = useState("pendiente");
  const [zonasDe, setZonasDe] = useState<string | null>(null);
  const { ask, modal } = usePasswordPrompt();
  const { data, isLoading, error } = useQuery<Agente[]>({
    queryKey: ["admin", "agentes", estado],
    queryFn: () => apiFetch<Agente[]>(`${API_ENDPOINTS.adminAgentes}?estado=${estado}`),
  });
  const accion = useMutation({
    mutationFn: ({ url, body }: { url: string; body?: Record<string, unknown> }) =>
      apiFetch<void>(url, { method: "POST", body: body ? JSON.stringify(body) : undefined }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["admin", "agentes"] }); toast.success("Actualizado"); },
    onError: (e) => toast.error((e as Error).message || "No se pudo actualizar"),
  });

  const aprobarConReauth = async (a: Agente) => {
    try {
      const password = await ask(`Aprobar a ${a.nombre} le da acceso pagado a zonas patrocinadas.`);
      accion.mutate({ url: API_ENDPOINTS.adminAgenteAprobar(a.id), body: { password } });
    } catch { /* cancelado */ }
  };
  const suspenderConReauth = async (a: Agente) => {
    try {
      const password = await ask(`Suspender a ${a.nombre} revoca su acceso pagado ya activo.`);
      accion.mutate({ url: API_ENDPOINTS.adminAgenteSuspender(a.id), body: { motivo: "Suspendido desde panel admin", password } });
    } catch { /* cancelado */ }
  };

  return (
    <div className="space-y-4">
      {modal}
      <div className="flex flex-wrap gap-1.5">
        {ESTADOS.map((e) => (
          <button key={e.id} onClick={() => setEstado(e.id)}
            className="rounded-full border px-3 py-1 text-xs font-medium transition"
            style={estado === e.id ? { borderColor: K.teal, background: "#E7F4EC", color: K.tealDeep } : { borderColor: K.line, color: K.muted }}>
            {e.label}
          </button>
        ))}
      </div>
      {isLoading && <p className="text-sm" style={{ color: K.muted }}>Cargando…</p>}
      {error && <AccessError error={error} />}
      {data && data.length === 0 && <p className="text-sm" style={{ color: K.muted }}>Sin agentes {estado}s.</p>}
      <div className="space-y-2">
        {data?.map((a) => (
          <div key={a.id} className="rounded-xl border" style={{ borderColor: K.line, background: "#FFFFFF" }}>
            <div className="flex flex-wrap items-center justify-between gap-3 p-3">
            <div className="min-w-0">
              <div className="font-medium" style={{ color: K.ink }}><Name>{a.nombre}</Name></div>
              <div className="text-xs" style={{ color: K.muted }}>{a.email}{a.telefono ? ` · ${a.telefono}` : ""}</div>
            </div>
            <div className="flex gap-2">
              <button onClick={() => setZonasDe(zonasDe === a.id ? null : a.id)}
                className="inline-flex items-center gap-1 rounded-lg border px-3 py-1.5 text-xs font-semibold" style={{ borderColor: K.line, color: K.tealDeep }}>
                <MapPinned className="h-3.5 w-3.5" /> Zonas
              </button>
              {estado === "pendiente" && (
                <>
                  <button onClick={() => aprobarConReauth(a)}
                    className="inline-flex items-center gap-1 rounded-lg px-3 py-1.5 text-xs font-semibold text-white" style={{ background: K.teal }}>
                    <Check className="h-3.5 w-3.5" /> Aprobar
                  </button>
                  <button onClick={() => accion.mutate({ url: API_ENDPOINTS.adminAgenteRechazar(a.id), body: { motivo: "Rechazado desde panel admin" } })}
                    disabled={accion.isPending}
                    className="inline-flex items-center gap-1 rounded-lg border px-3 py-1.5 text-xs font-semibold disabled:opacity-50" style={{ borderColor: K.coral, color: K.coral }}>
                    <X className="h-3.5 w-3.5" /> Rechazar
                  </button>
                </>
              )}
              {estado === "activo" && (
                <button onClick={() => suspenderConReauth(a)}
                  className="inline-flex items-center gap-1 rounded-lg border px-3 py-1.5 text-xs font-semibold" style={{ borderColor: K.amber, color: K.amber }}>
                  <Ban className="h-3.5 w-3.5" /> Suspender
                </button>
              )}
              {(estado === "rechazado" || estado === "inactivo") && (
                <button onClick={() => aprobarConReauth(a)}
                  className="inline-flex items-center gap-1 rounded-lg px-3 py-1.5 text-xs font-semibold text-white" style={{ background: K.teal }}>
                  <Check className="h-3.5 w-3.5" /> Reactivar
                </button>
              )}
            </div>
            </div>
            {zonasDe === a.id && <ZonasManager agentId={a.id} />}
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Gestor de zonas de un realtor (asignar/quitar comuna o barrio) ─────────────
type Zona = { id: string; zona_nivel: string; zona_codigo: string; nombre: string; estado: string; precio_mensual: number; fecha_fin: string };
type Catalogo = { comunas: { cd_comuna: number; nombre: string }[]; barrios: { id: number; nombre: string; cd_comuna: number }[] };

function ZonasManager({ agentId }: { agentId: string }) {
  const qc = useQueryClient();
  const [nivel, setNivel] = useState<"comuna" | "barrio">("comuna");
  const [comunaSel, setComunaSel] = useState("");
  const [barrioSel, setBarrioSel] = useState("");

  const zonas = useQuery<Zona[]>({
    queryKey: ["admin", "zonas", agentId],
    queryFn: () => apiFetch<Zona[]>(API_ENDPOINTS.adminAgenteZonas(agentId)),
  });
  const catalogo = useQuery<Catalogo>({
    queryKey: ["admin", "catalogo"],
    queryFn: () => apiFetch<Catalogo>(API_ENDPOINTS.adminZonasCatalogo),
    staleTime: 10 * 60 * 1000,
  });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["admin", "zonas", agentId] });
    qc.invalidateQueries({ queryKey: ["admin", "dashboard"] });
  };
  const agregar = useMutation({
    mutationFn: (body: { zona_nivel: string; zona_codigo: string }) =>
      apiFetch<void>(API_ENDPOINTS.adminAgenteZonas(agentId), { method: "POST", body: JSON.stringify(body) }),
    onSuccess: () => { invalidate(); toast.success("Zona asignada"); setComunaSel(""); setBarrioSel(""); },
    onError: (e) => toast.error(/409/.test(String((e as Error).message)) ? "Esa zona ya está asignada" : "No se pudo asignar"),
  });
  const quitar = useMutation({
    mutationFn: (id: string) => apiFetch<void>(API_ENDPOINTS.adminSponsorshipDelete(id), { method: "DELETE" }),
    onSuccess: () => { invalidate(); toast.success("Zona quitada"); },
    onError: () => toast.error("No se pudo quitar"),
  });

  const barriosDeComuna = (catalogo.data?.barrios ?? []).filter((b) => String(b.cd_comuna) === comunaSel);
  const puedeAgregar = nivel === "comuna" ? !!comunaSel : !!barrioSel;
  const onAgregar = () => {
    if (nivel === "comuna") agregar.mutate({ zona_nivel: "comuna", zona_codigo: comunaSel });
    else agregar.mutate({ zona_nivel: "barrio", zona_codigo: barrioSel });
  };

  return (
    <div className="border-t px-3 py-3" style={{ borderColor: K.line, background: K.surface }}>
      <div className="mb-2 text-xs font-semibold uppercase tracking-wider" style={{ color: K.muted }}>Zonas asignadas</div>
      {zonas.isLoading ? (
        <p className="text-xs" style={{ color: K.muted }}>Cargando…</p>
      ) : (zonas.data?.length ?? 0) === 0 ? (
        <p className="text-xs" style={{ color: K.muted }}>Sin zonas. Asigna una abajo.</p>
      ) : (
        <div className="mb-3 flex flex-wrap gap-2">
          {zonas.data!.map((z) => (
            <span key={z.id} className="inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs"
              style={{ borderColor: K.line, background: "#FFF", color: K.ink }}>
              <MapPinned className="h-3 w-3" style={{ color: z.zona_nivel === "comuna" ? K.teal : K.amber }} />
              {z.nombre ?? z.zona_codigo} <span style={{ color: K.muted }}>({z.zona_nivel})</span>
              <button onClick={() => quitar.mutate(z.id)} disabled={quitar.isPending} title="Quitar" className="ml-0.5 disabled:opacity-50" style={{ color: K.coral }}>
                <Trash2 className="h-3 w-3" />
              </button>
            </span>
          ))}
        </div>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <select value={nivel} onChange={(e) => { setNivel(e.target.value as "comuna" | "barrio"); setBarrioSel(""); }}
          className="rounded-md border px-2 py-1 text-xs" style={{ borderColor: K.line, color: K.ink, background: "#FFF" }}>
          <option value="comuna">Comuna</option>
          <option value="barrio">Barrio</option>
        </select>
        <select value={comunaSel} onChange={(e) => { setComunaSel(e.target.value); setBarrioSel(""); }}
          className="rounded-md border px-2 py-1 text-xs" style={{ borderColor: K.line, color: K.ink, background: "#FFF" }}>
          <option value="">{nivel === "comuna" ? "Elegir comuna…" : "Filtrar por comuna…"}</option>
          {catalogo.data?.comunas.map((c) => <option data-i18n-skip key={c.cd_comuna} value={String(c.cd_comuna)}>{c.nombre}</option>)}
        </select>
        {nivel === "barrio" && (
          <select value={barrioSel} onChange={(e) => setBarrioSel(e.target.value)} disabled={!comunaSel}
            className="rounded-md border px-2 py-1 text-xs" style={{ borderColor: K.line, color: K.ink, background: "#FFF" }}>
            <option value="">Elegir barrio…</option>
            {barriosDeComuna.map((b) => <option data-i18n-skip key={b.id} value={String(b.id)}>{b.nombre}</option>)}
          </select>
        )}
        <button onClick={onAgregar} disabled={!puedeAgregar || agregar.isPending}
          className="inline-flex items-center gap-1 rounded-lg px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50" style={{ background: K.teal }}>
          <Plus className="h-3.5 w-3.5" /> Asignar
        </button>
      </div>
      <p className="mt-1.5 text-[11px]" style={{ color: K.muted }}>Comuna ~$1.000.000/mes · Barrio ~$200.000/mes · vigencia 12 meses.</p>
    </div>
  );
}

// ── Destacado con alcance (barrio propio / comuna propia / toda la ciudad) ────
// Compartido por Eventos y Negocios — el backend resuelve la zona (barrio_id o
// cd_comuna) desde la ubicación real del item; el admin solo elige el nivel.
type NivelDestacado = "off" | "barrio" | "comuna" | "ciudad";
const nivelActual = (destacado: boolean, nivel: string | null): NivelDestacado =>
  !destacado ? "off" : ((nivel as NivelDestacado) || "ciudad");

type DestacadoBody = { destacado: boolean; destacado_nivel?: NivelDestacado; destacado_zona_codigo?: string };
type DestacadosCatalogo = { comunas: { codigo: string; nombre: string }[]; barrios: { id: number; nombre: string; municipio: string }[] };

function useDestacadosCatalogo() {
  return useQuery<DestacadosCatalogo>({
    queryKey: ["admin", "destacados-catalogo"],
    queryFn: () => apiFetch<DestacadosCatalogo>(API_ENDPOINTS.adminDestacadosCatalogo),
    staleTime: 10 * 60 * 1000,
  });
}

// Nivel + LA zona concreta (qué comuna, qué barrio) — el admin elige ambos.
// Cambiar a Barrio/Comuna no guarda hasta que se elige una zona del combo.
function DestacadoScope({ destacado, nivel, zonaCodigo, onSave, disabled }: {
  destacado: boolean; nivel: string | null; zonaCodigo: string | null;
  onSave: (body: DestacadoBody) => void; disabled?: boolean;
}) {
  const serverNivel = nivelActual(destacado, nivel);
  const [localNivel, setLocalNivel] = useState<NivelDestacado>(serverNivel);
  const [localZona, setLocalZona] = useState(zonaCodigo ?? "");
  useEffect(() => { setLocalNivel(serverNivel); setLocalZona(zonaCodigo ?? ""); }, [serverNivel, zonaCodigo]);
  const catalogo = useDestacadosCatalogo();

  const handleNivel = (v: NivelDestacado) => {
    setLocalNivel(v);
    if (v === "off") onSave({ destacado: false });
    else if (v === "ciudad") onSave({ destacado: true, destacado_nivel: "ciudad" });
    // barrio/comuna: espera a que elijan la zona en el segundo combo antes de guardar
  };
  const handleZona = (codigo: string) => {
    setLocalZona(codigo);
    if (codigo) onSave({ destacado: true, destacado_nivel: localNivel, destacado_zona_codigo: codigo });
  };

  const activo = localNivel !== "off";
  const barriosPorMunicipio = catalogo.data?.barrios.reduce<Record<string, typeof catalogo.data.barrios>>((acc, b) => {
    (acc[b.municipio] ??= []).push(b);
    return acc;
  }, {});

  return (
    <div className="flex items-center justify-end gap-1.5">
      <select
        value={localNivel}
        onChange={(e) => handleNivel(e.target.value as NivelDestacado)}
        disabled={disabled}
        title="Alcance del destacado"
        className="rounded-full border px-2.5 py-1 text-[11px] font-semibold disabled:opacity-50"
        style={activo ? { borderColor: K.teal, background: "#E7F4EC", color: K.tealDeep } : { borderColor: K.line, background: K.surface, color: K.muted }}
      >
        <option value="off">Apagado</option>
        <option value="barrio">★ Barrio</option>
        <option value="comuna">★ Comuna</option>
        <option value="ciudad">★ Ciudad</option>
      </select>
      {localNivel === "comuna" && (
        <select value={localZona} onChange={(e) => handleZona(e.target.value)} disabled={disabled || catalogo.isLoading}
          className="rounded-md border px-2 py-1 text-[11px]" style={{ borderColor: K.line, color: K.ink, background: "#FFF" }}>
          <option value="">{catalogo.isLoading ? "Cargando…" : "Elegir comuna…"}</option>
          {catalogo.data?.comunas.map((c) => <option data-i18n-skip key={c.codigo} value={c.codigo}>{c.nombre}</option>)}
        </select>
      )}
      {localNivel === "barrio" && (
        <select value={localZona} onChange={(e) => handleZona(e.target.value)} disabled={disabled || catalogo.isLoading}
          className="rounded-md border px-2 py-1 text-[11px]" style={{ borderColor: K.line, color: K.ink, background: "#FFF" }}>
          <option value="">{catalogo.isLoading ? "Cargando…" : "Elegir barrio…"}</option>
          {Object.entries(barriosPorMunicipio ?? {}).map(([municipio, barrios]) => (
            <optgroup key={municipio} label={municipio}>
              {barrios.map((b) => <option data-i18n-skip key={b.id} value={String(b.id)}>{b.nombre}</option>)}
            </optgroup>
          ))}
        </select>
      )}
    </div>
  );
}

// ── Eventos destacados (los que pagan por aparecer arriba) ────────────────────
type EventoRow = {
  id: number; titulo: string; categoria: string | null; fecha_inicio: string;
  destacado: boolean; destacado_nivel: string | null; destacado_zona_codigo: string | null; barrio_id: number | null;
  gratuito: boolean; barrio: string | null;
};

function EventosTab() {
  const qc = useQueryClient();
  const { data, isLoading, error } = useQuery<{ eventos: EventoRow[] }>({
    queryKey: ["admin", "eventos"],
    queryFn: () => apiFetch<{ eventos: EventoRow[] }>(API_ENDPOINTS.adminEventos),
  });
  const editar = useMutation({
    mutationFn: ({ id, body }: { id: number; body: DestacadoBody }) =>
      apiFetch<void>(API_ENDPOINTS.adminEventoEditar(id), { method: "PATCH", body: JSON.stringify(body) }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["admin", "eventos"] }); toast.success("Evento actualizado"); },
    onError: (e) => toast.error((e as Error).message || "No se pudo actualizar"),
  });
  if (isLoading) return <p className="text-sm" style={{ color: K.muted }}>Cargando…</p>;
  if (error || !data) return <AccessError error={error} />;
  const destacados = data.eventos.filter((e) => e.destacado).length;
  return (
    <div className="space-y-3">
      <p className="text-sm" style={{ color: K.muted }}>
        {data.eventos.length} eventos próximos · {destacados} destacado{destacados !== 1 ? "s" : ""} · alcance: barrio propio, su comuna, o toda la ciudad
      </p>
      <div className="overflow-x-auto rounded-xl border" style={{ borderColor: K.line, background: "#FFFFFF" }}>
        <table className="w-full min-w-[640px] text-sm">
          <thead>
            <tr className="border-b text-left text-xs" style={{ borderColor: K.line, color: K.muted }}>
              <th className="px-4 py-3 font-medium">Evento</th>
              <th className="px-4 py-3 font-medium">Categoría</th>
              <th className="px-4 py-3 font-medium">Fecha</th>
              <th className="px-4 py-3 text-center font-medium">Destacado</th>
            </tr>
          </thead>
          <tbody>
            {data.eventos.map((e) => (
              <tr key={e.id} className="border-b last:border-0" style={{ borderColor: K.line }}>
                <td className="px-4 py-3">
                  <div className="font-medium" style={{ color: K.ink }}>{e.titulo}</div>
                  <div className="text-xs" style={{ color: K.muted }}>{e.barrio ?? "—"}{e.gratuito ? " · gratis" : ""}</div>
                </td>
                <td className="px-4 py-3 capitalize" style={{ color: K.muted }}>{e.categoria ?? "—"}</td>
                <td className="px-4 py-3 text-xs" style={{ color: K.muted }}>
                  {new Date(e.fecha_inicio).toLocaleDateString("es-CO", { day: "2-digit", month: "short" })}
                </td>
                <td className="px-4 py-3 text-center">
                  <DestacadoScope
                    destacado={e.destacado} nivel={e.destacado_nivel} zonaCodigo={e.destacado_zona_codigo}
                    disabled={editar.isPending}
                    onSave={(body) => editar.mutate({ id: e.id, body })}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── Negocios locales (tiendas) — mismo destacado con alcance ───────────────────
type TiendaRow = {
  id: number; nombre: string; categoria: string | null;
  destacado: boolean; destacado_nivel: string | null; destacado_zona_codigo: string | null;
  barrio_id: number | null; barrio: string | null; municipio: string | null;
};
type TiendasAdminResp = { total: number; page: number; pages: number; tiendas: TiendaRow[] };

function NegociosTab() {
  const qc = useQueryClient();
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [searchInput, setSearchInput] = useState("");

  const { data, isLoading, error } = useQuery<TiendasAdminResp>({
    queryKey: ["admin", "tiendas", page, search],
    queryFn: () => apiFetch<TiendasAdminResp>(
      `${API_ENDPOINTS.adminTiendas}?page=${page}&limit=20${search ? `&search=${encodeURIComponent(search)}` : ""}`
    ),
  });
  const editar = useMutation({
    mutationFn: ({ id, body }: { id: number; body: DestacadoBody }) =>
      apiFetch<void>(API_ENDPOINTS.adminTiendaEditar(id), { method: "PATCH", body: JSON.stringify(body) }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["admin", "tiendas"] }); toast.success("Negocio actualizado"); },
    onError: (e) => toast.error((e as Error).message || "No se pudo actualizar"),
  });

  const buscar = (e: React.FormEvent) => { e.preventDefault(); setPage(1); setSearch(searchInput.trim()); };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm" style={{ color: K.muted }}>
          {data ? `${data.total.toLocaleString("es-CO")} negocios` : "Cargando…"} · alcance: barrio propio, su comuna, o toda la ciudad
        </p>
        <form onSubmit={buscar} className="flex items-center gap-1.5">
          <div className="relative">
            <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2" style={{ color: K.muted }} />
            <input
              value={searchInput} onChange={(e) => setSearchInput(e.target.value)}
              placeholder="Buscar por nombre…"
              className="rounded-md border py-1.5 pl-7 pr-2 text-xs" style={{ borderColor: K.line, color: K.ink }}
            />
          </div>
          <button type="submit" className="rounded-md px-3 py-1.5 text-xs font-semibold text-white" style={{ background: K.tealDeep }}>Buscar</button>
        </form>
      </div>

      {isLoading && <p className="text-sm" style={{ color: K.muted }}>Cargando…</p>}
      {error && <AccessError error={error} />}
      {data && data.tiendas.length === 0 && <p className="text-sm" style={{ color: K.muted }}>Sin resultados.</p>}

      {data && data.tiendas.length > 0 && (
        <div className="overflow-x-auto rounded-xl border" style={{ borderColor: K.line, background: "#FFFFFF" }}>
          <table className="w-full min-w-[640px] text-sm">
            <thead>
              <tr className="border-b text-left text-xs" style={{ borderColor: K.line, color: K.muted }}>
                <th className="px-4 py-3 font-medium">Negocio</th>
                <th className="px-4 py-3 font-medium">Categoría</th>
                <th className="px-4 py-3 text-center font-medium">Destacado</th>
              </tr>
            </thead>
            <tbody>
              {data.tiendas.map((t) => (
                <tr key={t.id} className="border-b last:border-0" style={{ borderColor: K.line }}>
                  <td className="px-4 py-3">
                    <div className="font-medium" style={{ color: K.ink }}><Name>{t.nombre}</Name></div>
                    <div className="text-xs" style={{ color: K.muted }}>{[t.barrio, t.municipio].filter(Boolean).join(", ") || "—"}</div>
                  </td>
                  <td className="px-4 py-3 capitalize" style={{ color: K.muted }}>{t.categoria ?? "—"}</td>
                  <td className="px-4 py-3 text-center">
                    <DestacadoScope
                      destacado={t.destacado} nivel={t.destacado_nivel} zonaCodigo={t.destacado_zona_codigo}
                      disabled={editar.isPending || !t.barrio_id}
                      onSave={(body) => editar.mutate({ id: t.id, body })}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {data && data.pages > 1 && (
        <div className="flex items-center justify-between text-xs" style={{ color: K.muted }}>
          <span>Página {data.page} de {data.pages}</span>
          <div className="flex gap-1.5">
            <button onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page <= 1}
              className="inline-flex items-center gap-1 rounded-md border px-2 py-1 disabled:opacity-40" style={{ borderColor: K.line }}>
              <ChevronLeft className="h-3.5 w-3.5" /> Anterior
            </button>
            <button onClick={() => setPage((p) => Math.min(data.pages, p + 1))} disabled={page >= data.pages}
              className="inline-flex items-center gap-1 rounded-md border px-2 py-1 disabled:opacity-40" style={{ borderColor: K.line }}>
              Siguiente <ChevronRight className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Leads (usuarios que pidieron agente / cotización) ──────────────────────────
type LeadRow = {
  lead_id: number; estado: string; asignado_a: string | null; notas: string | null; registrado: string;
  usuario: { id: number; nombre: string; email: string };
  perfil: { presupuesto: string | null; objetivo: string | null; perfil_riesgo: string | null; wants_agent: boolean | null };
};
const LEAD_ESTADOS = [
  { id: "nuevo", label: "Nuevo" },
  { id: "contactado", label: "Contactado" },
  { id: "calificado", label: "Calificado" },
  { id: "cerrado", label: "Cerrado" },
  { id: "descartado", label: "Descartado" },
];

function LeadsTab() {
  const qc = useQueryClient();
  const [filtro, setFiltro] = useState<string>("todos");
  const [notasAbierto, setNotasAbierto] = useState<number | null>(null);
  const [notas, setNotas] = useState("");
  const { data, isLoading, error } = useQuery<{ leads: LeadRow[]; total: number }>({
    queryKey: ["admin", "leads"],
    queryFn: () => apiFetch<{ leads: LeadRow[]; total: number }>(API_ENDPOINTS.adminLeads),
  });
  const editar = useMutation({
    mutationFn: ({ id, body }: { id: number; body: { estado?: string; notas?: string } }) =>
      apiFetch<void>(API_ENDPOINTS.adminLead(id), { method: "PUT", body: JSON.stringify(body) }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["admin", "leads"] }); toast.success("Lead actualizado"); },
    onError: () => toast.error("No se pudo actualizar"),
  });

  if (isLoading) return <p className="text-sm" style={{ color: K.muted }}>Cargando…</p>;
  if (error || !data) return <AccessError error={error} />;
  const leads = filtro === "todos" ? data.leads : data.leads.filter((l) => l.estado === filtro);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm" style={{ color: K.muted }}>{data.total} leads · piden conexión con un agente</p>
        <div className="flex flex-wrap gap-1.5">
          <button onClick={() => setFiltro("todos")}
            className="rounded-full border px-3 py-1 text-xs font-medium transition"
            style={filtro === "todos" ? { borderColor: K.teal, background: "#E7F4EC", color: K.tealDeep } : { borderColor: K.line, color: K.muted }}>
            Todos
          </button>
          {LEAD_ESTADOS.map((e) => (
            <button key={e.id} onClick={() => setFiltro(e.id)}
              className="rounded-full border px-3 py-1 text-xs font-medium transition"
              style={filtro === e.id ? { borderColor: K.teal, background: "#E7F4EC", color: K.tealDeep } : { borderColor: K.line, color: K.muted }}>
              {e.label}
            </button>
          ))}
        </div>
      </div>
      {leads.length === 0 && <p className="text-sm" style={{ color: K.muted }}>Sin leads en este filtro.</p>}
      <div className="space-y-2">
        {leads.map((l) => (
          <div key={l.lead_id} className="rounded-xl border p-3" style={{ borderColor: K.line, background: "#FFFFFF" }}>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="font-medium" style={{ color: K.ink }}>{l.usuario.nombre || l.usuario.email}</div>
                <div className="text-xs" style={{ color: K.muted }}>{l.usuario.email} · {l.registrado}</div>
                <div className="mt-1 flex flex-wrap gap-1.5">
                  {l.perfil.objetivo && <span className="rounded-full px-2 py-0.5 text-[11px]" style={{ background: K.surface, color: K.muted }}>{l.perfil.objetivo}</span>}
                  {l.perfil.perfil_riesgo && <span className="rounded-full px-2 py-0.5 text-[11px]" style={{ background: K.surface, color: K.muted }}>{l.perfil.perfil_riesgo}</span>}
                  {l.perfil.presupuesto && <span className="rounded-full px-2 py-0.5 text-[11px]" style={{ background: K.surface, color: K.muted }}>{l.perfil.presupuesto}</span>}
                </div>
              </div>
              <select
                value={l.estado}
                onChange={(e) => editar.mutate({ id: l.lead_id, body: { estado: e.target.value } })}
                className="rounded-md border px-2 py-1 text-xs" style={{ borderColor: K.line, color: K.ink, background: "#FFF" }}
              >
                {LEAD_ESTADOS.map((e) => <option key={e.id} value={e.id}>{e.label}</option>)}
              </select>
            </div>
            {notasAbierto === l.lead_id ? (
              <div className="mt-2 flex flex-col gap-1.5">
                <textarea value={notas} onChange={(ev) => setNotas(ev.target.value)} rows={2}
                  placeholder="Notas de seguimiento…" className="rounded-md border px-2 py-1.5 text-xs" style={{ borderColor: K.line, color: K.ink, resize: "none" }} />
                <div className="flex gap-1.5">
                  <button onClick={() => { editar.mutate({ id: l.lead_id, body: { notas } }); setNotasAbierto(null); }}
                    className="rounded-lg px-3 py-1 text-xs font-semibold text-white" style={{ background: K.tealDeep }}>Guardar</button>
                  <button onClick={() => setNotasAbierto(null)} className="text-xs" style={{ color: K.muted }}>Cancelar</button>
                </div>
              </div>
            ) : (
              <button onClick={() => { setNotasAbierto(l.lead_id); setNotas(l.notas ?? ""); }}
                className="mt-2 text-xs underline" style={{ color: K.muted }}>
                {l.notas ? `Notas: ${l.notas}` : "Agregar nota"}
              </button>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Seguridad: audit log inmutable (capa 2) + explicación de las 3 capas ──────
type AuditEntry = { id: number; admin_email: string; accion: string; entidad: string; entidad_id: string | null; detalle: Record<string, unknown> | null; ip: string | null; created_at: string; hace_cuanto: string };

function SeguridadTab() {
  const { data, isLoading, error } = useQuery<{ entradas: AuditEntry[] }>({
    queryKey: ["admin", "audit-log"],
    queryFn: () => apiFetch<{ entradas: AuditEntry[] }>(API_ENDPOINTS.adminAuditLog),
    refetchInterval: 30_000,
  });
  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-3">
        <div className="rounded-xl border p-4" style={{ borderColor: K.line, background: "#FFFFFF" }}>
          <div className="mb-1 flex items-center gap-1.5" style={{ color: K.teal }}><ShieldCheck className="h-4 w-4" /><span className="text-xs font-semibold">Capa 1 · Acceso</span></div>
          <p className="text-xs" style={{ color: K.muted }}>Solo el email admin autenticado con JWT ve este panel. Todo lo demás recibe 403.</p>
        </div>
        <div className="rounded-xl border p-4" style={{ borderColor: K.line, background: "#FFFFFF" }}>
          <div className="mb-1 flex items-center gap-1.5" style={{ color: K.teal }}><Activity className="h-4 w-4" /><span className="text-xs font-semibold">Capa 2 · Audit log</span></div>
          <p className="text-xs" style={{ color: K.muted }}>Cada acción que otorga/revoca acceso queda registrada abajo, sin ruta de borrado.</p>
        </div>
        <div className="rounded-xl border p-4" style={{ borderColor: K.line, background: "#FFFFFF" }}>
          <div className="mb-1 flex items-center gap-1.5" style={{ color: K.teal }}><Lock className="h-4 w-4" /><span className="text-xs font-semibold">Capa 3 · Re-auth</span></div>
          <p className="text-xs" style={{ color: K.muted }}>Cambiar plan, activo, o aprobar/suspender agentes pide tu contraseña de nuevo. Además, rate limit (30/min) en toda mutación admin.</p>
        </div>
      </div>

      {isLoading && <p className="text-sm" style={{ color: K.muted }}>Cargando…</p>}
      {error && <AccessError error={error} />}
      {data && (
        <div className="overflow-x-auto rounded-xl border" style={{ borderColor: K.line, background: "#FFFFFF" }}>
          <table className="w-full min-w-[680px] text-sm">
            <thead>
              <tr className="border-b text-left text-xs" style={{ borderColor: K.line, color: K.muted }}>
                <th className="px-4 py-3 font-medium">Cuándo</th>
                <th className="px-4 py-3 font-medium">Admin</th>
                <th className="px-4 py-3 font-medium">Acción</th>
                <th className="px-4 py-3 font-medium">Sobre</th>
                <th className="px-4 py-3 font-medium">IP</th>
              </tr>
            </thead>
            <tbody>
              {data.entradas.map((e) => (
                <tr key={e.id} className="border-b last:border-0" style={{ borderColor: K.line }}>
                  <td className="px-4 py-3 text-xs" style={{ color: K.muted }}>{e.hace_cuanto}</td>
                  <td className="px-4 py-3 text-xs" style={{ color: K.ink }}>{e.admin_email}</td>
                  <td className="px-4 py-3 text-xs font-medium" style={{ color: K.tealDeep }}>{e.accion}</td>
                  <td className="px-4 py-3 text-xs" style={{ color: K.muted }}>{e.entidad}{e.entidad_id ? ` #${e.entidad_id}` : ""}</td>
                  <td className="px-4 py-3 text-xs" style={{ color: K.muted }}>{e.ip ?? "—"}</td>
                </tr>
              ))}
              {data.entradas.length === 0 && (
                <tr><td colSpan={5} className="px-4 py-6 text-center text-xs" style={{ color: K.muted }}>Sin actividad registrada aún.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ── Usuarios (editable: plan + activo) ─────────────────────────────────────────
type UsuarioRow = {
  id: number; nombre: string | null; email: string; created_at: string | null;
  plan?: string | null; activo?: boolean;
  perfil: { presupuesto: string | null; objetivo: string | null; perfil_riesgo: string | null };
  stats: { barrios_visitados: number; simulaciones: number; comparaciones: number; favoritos: number };
};
type UsuariosResp = { usuarios: UsuarioRow[]; total: number; page: number; pages: number };
const actividadTotal = (u: UsuarioRow) => u.stats.barrios_visitados + u.stats.simulaciones + u.stats.comparaciones + u.stats.favoritos;

function UsuariosTab() {
  const qc = useQueryClient();
  const { ask, modal } = usePasswordPrompt();
  const { data, isLoading, error } = useQuery<UsuariosResp>({
    queryKey: ["admin", "usuarios"],
    queryFn: () => apiFetch<UsuariosResp>(API_ENDPOINTS.adminUsuarios),
  });
  const editar = useMutation({
    mutationFn: ({ id, body }: { id: number; body: { plan?: string; activo?: boolean; password?: string } }) =>
      apiFetch<void>(API_ENDPOINTS.adminUsuarioEditar(id), { method: "PATCH", body: JSON.stringify(body) }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["admin", "usuarios"] }); qc.invalidateQueries({ queryKey: ["admin", "dashboard"] }); toast.success("Usuario actualizado"); },
    onError: (e) => toast.error((e as Error).message || "No se pudo actualizar"),
  });

  const cambiarPlan = async (u: UsuarioRow, plan: string) => {
    try {
      const password = await ask(`Dar plan "${plan}" a ${u.email}.`);
      editar.mutate({ id: u.id, body: { plan, password } });
    } catch { /* cancelado */ }
  };
  const toggleActivo = async (u: UsuarioRow) => {
    try {
      const password = await ask(`${(u.activo ?? true) ? "Desactivar" : "Activar"} la cuenta de ${u.email}.`);
      editar.mutate({ id: u.id, body: { activo: !(u.activo ?? true), password } });
    } catch { /* cancelado */ }
  };

  if (isLoading) return <p className="text-sm" style={{ color: K.muted }}>Cargando…</p>;
  if (error || !data) return <AccessError error={error} />;
  return (
    <div className="space-y-3">
      {modal}
      <p className="text-sm" style={{ color: K.muted }}>{data.total} usuarios · edita plan (acceso Pro/Agente) o desactiva cuenta</p>
      <div className="overflow-x-auto rounded-xl border" style={{ borderColor: K.line, background: "#FFFFFF" }}>
        <table className="w-full min-w-[680px] text-sm">
          <thead>
            <tr className="border-b text-left text-xs" style={{ borderColor: K.line, color: K.muted }}>
              <th className="px-4 py-3 font-medium">Usuario</th>
              <th className="px-4 py-3 font-medium">Objetivo</th>
              <th className="px-4 py-3 text-right font-medium">Actividad</th>
              <th className="px-4 py-3 font-medium">Plan (acceso)</th>
              <th className="px-4 py-3 text-center font-medium">Activo</th>
            </tr>
          </thead>
          <tbody>
            {data.usuarios.map((u) => (
              <tr key={u.id} className="border-b last:border-0" style={{ borderColor: K.line }}>
                <td className="px-4 py-3">
                  <div className="font-medium" style={{ color: K.ink }}>{u.nombre ?? "—"}</div>
                  <div className="text-xs" style={{ color: K.muted }}>{u.email}</div>
                </td>
                <td className="px-4 py-3 capitalize" style={{ color: K.muted }}>{u.perfil?.objetivo ?? "—"}</td>
                <td className="px-4 py-3 text-right" style={{ color: K.ink }}>{actividadTotal(u)}</td>
                <td className="px-4 py-3">
                  <select
                    value={u.plan ?? "free"}
                    onChange={(e) => cambiarPlan(u, e.target.value)}
                    className="rounded-md border px-2 py-1 text-xs" style={{ borderColor: K.line, color: K.ink, background: "#FFF" }}
                  >
                    <option value="free">Free</option>
                    <option value="pro">Pro</option>
                    <option value="agente">Agente</option>
                  </select>
                </td>
                <td className="px-4 py-3 text-center">
                  <button
                    onClick={() => toggleActivo(u)}
                    className="rounded-full px-2.5 py-1 text-[11px] font-semibold"
                    style={(u.activo ?? true)
                      ? { background: "#E7F4EC", color: K.tealDeep }
                      : { background: "#FDECEA", color: K.coral }}
                    title="Click para alternar"
                  >
                    {(u.activo ?? true) ? "Activo" : "Inactivo"}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {data.pages > 1 && <p className="text-xs" style={{ color: K.muted }}>Página 1 de {data.pages}. (Paginación + búsqueda en fase siguiente.)</p>}
    </div>
  );
}
