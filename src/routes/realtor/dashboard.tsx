import { createFileRoute, Link, redirect } from "@tanstack/react-router";
import { RouteError, RoutePending } from "@/components/RouteStates";
import { useEffect, useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Inbox, MapPinned, Plus } from "@/lib/icons";
import { PieChart, Pie, Cell } from "recharts";
import { apiFetch } from "@/lib/apiClient";
import { API_ENDPOINTS } from "@/config/api";
import { Skeleton } from "@/components/ui/skeleton";
import { formatCOP } from "@/lib/format";
import { LanguageToggle } from "@/lib/i18n";
import {
  datosMinimosCompletos,
  realtorApi,
  type Agenda,
  type EstadoListing,
  type Franja,
  type ItemAsignado,
  type ItemPool,
  type MiListing,
  type RoiZona,
  type VisitaSolicitud,
  type ZonaNivel,
} from "@/lib/realtorApi";
import { toast } from "sonner";
import {
  useAceptarAsignado,
  useActualizarVisita,
  useAgenda,
  useDesempeno,
  useDueDiligence,
  useInteligenciaBarrio,
  useMisListings,
  usePublicarAsignado,
  useRealtorAsignados,
  useRealtorPerfil,
  useRealtorPool,
  useEditarListing,
  useTomarDelPool,
  useVerificarDDItem,
} from "@/hooks/useRealtorDashboard";

export const Route = createFileRoute("/realtor/dashboard")({
  errorComponent: RouteError,
  pendingComponent: RoutePending,
  beforeLoad: () => {
    if (typeof window === "undefined") return;
    const raw = localStorage.getItem("medellin-social.user");
    if (!raw) throw redirect({ to: "/login" });
  },
  component: RealtorDashboardPage,
  head: () => ({
    meta: [{ title: "Dashboard · Realtor · Medellín Social" }],
  }),
});

// ── Tabs ───────────────────────────────────────────────────────────────────────

type Tab = "resultados" | "inbox" | "agenda" | "listings" | "desempeno" | "inteligencia" | "config";

const TABS: { id: Tab; label: string }[] = [
  { id: "resultados",   label: "Resultados" },
  { id: "inbox",        label: "Inbox" },
  { id: "agenda",       label: "Agenda" },
  { id: "listings",     label: "Mis listings" },
  { id: "desempeno",    label: "Desempeño" },
  { id: "inteligencia", label: "Inteligencia" },
  { id: "config",       label: "Configuración" },
];

function RealtorDashboardPage() {
  const [tab, setTab] = useState<Tab>("resultados");
  const { isError, error, isLoading } = useRealtorPerfil();

  // La cuenta logueada existe pero no tiene fila `agent` (backend responde 403
  // en /realtor/me y por extensión en todos los demás endpoints). Sin este
  // check el dashboard se ve "vacío": nav sin perfil + cajas de error sueltas
  // en cada tab, que es indistinguible de "no carga nada".
  const sinAgente = isError && /no es un agente/i.test(String((error as Error)?.message ?? ""));

  if (!isLoading && sinAgente) {
    return (
      <div className="paper-theme grid min-h-screen place-items-center bg-background px-4">
        <div className="max-w-sm text-center">
          <h1 className="text-lg font-semibold text-foreground">Esta cuenta no es un agente</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            El dashboard de realtor solo funciona para cuentas registradas como agente inmobiliario.
            Inicia sesión con tu cuenta de agente o solicita el registro.
          </p>
          <Link
            to="/map"
            className="mt-4 inline-flex items-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground transition hover:opacity-90"
          >
            <ArrowLeft className="h-4 w-4" /> Volver al mapa
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="paper-theme min-h-screen bg-background">
      <RealtorNav tab={tab} onTab={setTab} />
      <main className="mx-auto max-w-6xl px-4 pb-20 pt-8 sm:px-6">
        {tab === "resultados"   && <ResultadosTab />}
        {tab === "inbox"        && <InboxTab />}
        {tab === "agenda"       && <AgendaTab />}
        {tab === "listings"     && <ListingsTab />}
        {tab === "desempeno"    && <DesempenoTab />}
        {tab === "inteligencia" && <InteligenciaTab />}
        {tab === "config"       && <ConfiguracionTab />}
      </main>
    </div>
  );
}

// ── Nav ────────────────────────────────────────────────────────────────────────

function RealtorNav({ tab, onTab }: { tab: Tab; onTab: (t: Tab) => void }) {
  const { data: perfil } = useRealtorPerfil();
  const { data: asignados } = useRealtorAsignados();
  const { data: agenda } = useAgenda();

  const nuevos = asignados?.filter((a) => a.estado === "asignado").length ?? 0;
  const visitasPendientes = agenda?.visitas.filter((v) => v.estado === "pendiente").length ?? 0;
  const initials = perfil?.nombre.split(/\s+/).map((s) => s[0]).slice(0, 2).join("").toUpperCase();

  return (
    <header className="sticky top-0 z-40 border-b border-border bg-background/95 backdrop-blur">
      <div className="mx-auto flex h-14 max-w-6xl items-center justify-between gap-4 px-4 sm:px-6">
        <div className="flex min-w-0 items-center gap-4">
          <Link
            to="/map"
            className="inline-flex shrink-0 items-center gap-1.5 text-sm text-muted-foreground transition hover:text-foreground"
          >
            <ArrowLeft className="h-4 w-4" /> Mapa
          </Link>
          <span className="h-5 w-px bg-border" aria-hidden />
          <span className="truncate text-sm font-semibold text-foreground">Centro de agente</span>
        </div>

        {perfil && (
          <div className="flex shrink-0 items-center gap-3">
            <LanguageToggle />
            {perfil.estado === "pendiente" && (
              <span className="hidden text-xs text-warning sm:block">Cuenta pendiente de aprobación</span>
            )}
            <div className="flex items-center gap-2">
              <div className="grid h-8 w-8 place-items-center overflow-hidden rounded-full border border-border bg-surface text-xs font-semibold text-foreground">
                {perfil.avatar
                  ? <img src={perfil.avatar} alt={perfil.nombre} className="h-full w-full object-cover" />
                  : initials}
              </div>
              <div className="hidden md:block">
                <div className="text-sm font-medium leading-tight text-foreground">{perfil.nombre}</div>
                {perfil.zonas_patrocinadas.length > 0 && (
                  <div className="text-[11px] leading-tight text-muted-foreground">
                    {perfil.zonas_patrocinadas.map((z) => z.nombre).join(" · ")}
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </div>

      <nav className="mx-auto max-w-6xl overflow-x-auto px-4 sm:px-6" aria-label="Secciones del dashboard">
        <div className="flex gap-6">
          {TABS.map(({ id, label }) => (
            <button
              key={id}
              onClick={() => onTab(id)}
              aria-current={tab === id ? "page" : undefined}
              className={`relative shrink-0 border-b-2 pb-2.5 pt-1 text-sm transition ${
                tab === id
                  ? "border-primary font-semibold text-foreground"
                  : "border-transparent font-medium text-muted-foreground hover:text-foreground"
              }`}
            >
              {label}
              {id === "inbox" && nuevos > 0 && (
                <span className="ml-1.5 rounded-full bg-primary px-1.5 py-0.5 text-[10px] font-semibold text-primary-foreground">
                  {nuevos}
                </span>
              )}
              {id === "agenda" && visitasPendientes > 0 && (
                <span className="ml-1.5 rounded-full bg-primary px-1.5 py-0.5 text-[10px] font-semibold text-primary-foreground">
                  {visitasPendientes}
                </span>
              )}
            </button>
          ))}
          <span className="my-auto h-4 w-px shrink-0 bg-border" aria-hidden />
          <Link
            to="/comparador"
            className="shrink-0 border-b-2 border-transparent pb-2.5 pt-1 text-sm font-medium text-muted-foreground transition hover:text-foreground"
          >
            Comparador
          </Link>
          <Link
            to="/simulador"
            className="shrink-0 border-b-2 border-transparent pb-2.5 pt-1 text-sm font-medium text-muted-foreground transition hover:text-foreground"
          >
            Simulador
          </Link>
        </div>
      </nav>
    </header>
  );
}

// ══ TAB 1: Inbox — lista | detalle ═════════════════════════════════════════════

type LeadItem =
  | { kind: "asignado"; id: string; data: ItemAsignado }
  | { kind: "pool"; id: string; data: ItemPool };

type LeadFilter = "todos" | "nuevos" | "proceso" | "pool";

const LEAD_FILTERS: { id: LeadFilter; label: string }[] = [
  { id: "todos",   label: "Todos" },
  { id: "nuevos",  label: "Nuevos" },
  { id: "proceso", label: "En proceso" },
  { id: "pool",    label: "Pool" },
];

function InboxTab() {
  const { data: asignados, isLoading: loadA, isError: errA } = useRealtorAsignados();
  const { data: pool, isLoading: loadP } = useRealtorPool();

  const [filtro, setFiltro] = useState<LeadFilter>("todos");
  const [busqueda, setBusqueda] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const leads = useMemo<LeadItem[]>(() => {
    const a: LeadItem[] = (asignados ?? []).map((x) => ({ kind: "asignado", id: x.id, data: x }));
    const p: LeadItem[] = (pool ?? []).map((x) => ({ kind: "pool", id: x.id, data: x }));
    const rank = (l: LeadItem) =>
      l.kind === "pool" ? 2 : l.data.estado === "asignado" ? 0 : 1;
    return [...a, ...p].sort((x, y) =>
      rank(x) !== rank(y) ? rank(x) - rank(y) : y.data.created_at.localeCompare(x.data.created_at),
    );
  }, [asignados, pool]);

  const visibles = useMemo(() => {
    let out = leads;
    if (filtro === "nuevos")  out = out.filter((l) => l.kind === "asignado" && l.data.estado === "asignado");
    if (filtro === "proceso") out = out.filter((l) => l.kind === "asignado" && l.data.estado !== "asignado");
    if (filtro === "pool")    out = out.filter((l) => l.kind === "pool");
    const q = busqueda.trim().toLowerCase();
    if (q) {
      out = out.filter((l) => {
        const d = l.data;
        const owner = l.kind === "asignado" ? l.data.owner_nombre : "";
        return `${d.barrio} ${d.municipio} ${d.tipo_inmueble} ${owner}`.toLowerCase().includes(q);
      });
    }
    return out;
  }, [leads, filtro, busqueda]);

  const selected = visibles.find((l) => l.id === selectedId) ?? null;
  const loading = loadA || loadP;

  if (loading) {
    return (
      <div className="grid gap-6 lg:grid-cols-[320px_1fr]">
        <SkeletonRows n={5} />
        <Skeleton className="hidden h-96 rounded-lg lg:block" />
      </div>
    );
  }

  if (errA) return <SectionError msg="No se pudieron cargar los inmuebles asignados." />;

  return (
    <div className="grid gap-6 lg:grid-cols-[320px_1fr]">
      {/* Lista */}
      <div className={`${selected ? "hidden lg:block" : ""}`}>
        <input
          type="search"
          value={busqueda}
          onChange={(e) => setBusqueda(e.target.value)}
          placeholder="Buscar por barrio u owner"
          className={inputCls}
          aria-label="Buscar leads"
        />
        <div className="mt-3 flex gap-4 border-b border-border text-sm">
          {LEAD_FILTERS.map((f) => (
            <button
              key={f.id}
              onClick={() => setFiltro(f.id)}
              className={`border-b-2 pb-2 transition ${
                filtro === f.id
                  ? "border-primary font-semibold text-foreground"
                  : "border-transparent text-muted-foreground hover:text-foreground"
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>

        <div className="mt-3 overflow-hidden rounded-lg border border-border bg-surface">
          {visibles.length === 0 && (
            <div className="px-4 py-12 text-center">
              <Inbox className="mx-auto h-5 w-5 text-muted-foreground/50" />
              <p className="mx-auto mt-2 max-w-[220px] text-sm text-muted-foreground">
                {filtro === "pool"
                  ? "El pool está vacío por ahora."
                  : "Sin leads en esta vista. Cuando un propietario publique en tu zona, aparecerá aquí."}
              </p>
            </div>
          )}
          {visibles.map((l, i) => (
            <LeadListRow
              key={l.id}
              lead={l}
              active={l.id === selectedId}
              first={i === 0}
              onClick={() => setSelectedId(l.id)}
            />
          ))}
        </div>
      </div>

      {/* Detalle */}
      <div className={`${selected ? "" : "hidden lg:block"}`}>
        {selected ? (
          <LeadDetail lead={selected} onBack={() => setSelectedId(null)} />
        ) : (
          <div className="grid h-full min-h-[320px] place-items-center rounded-lg border border-dashed border-border">
            <div className="text-center">
              <Inbox className="mx-auto h-5 w-5 text-muted-foreground/50" />
              <p className="mt-2 text-sm text-muted-foreground">Selecciona un lead para ver el detalle</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function LeadListRow({
  lead,
  active,
  first,
  onClick,
}: {
  lead: LeadItem;
  active: boolean;
  first: boolean;
  onClick: () => void;
}) {
  const d = lead.data;
  const esNuevo = lead.kind === "asignado" && lead.data.estado === "asignado";
  const titulo = lead.kind === "asignado" ? lead.data.owner_nombre : "Pool abierto";

  return (
    <button
      onClick={onClick}
      aria-current={active ? "true" : undefined}
      className={`block w-full border-l-2 px-4 py-3 text-left transition ${
        first ? "" : "border-t border-border/70"
      } ${active ? "border-l-primary bg-primary/5" : "border-l-transparent hover:bg-muted/40"}`}
    >
      <span className="flex items-baseline justify-between gap-2">
        <span className={`flex min-w-0 items-center gap-2 text-sm ${esNuevo ? "font-semibold" : "font-medium"} text-foreground`}>
          {esNuevo && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-primary" aria-label="Nuevo" />}
          <span className="truncate">{titulo}</span>
        </span>
        <span className="shrink-0 text-xs text-muted-foreground">{relativeTime(d.created_at)}</span>
      </span>
      <span className="mt-0.5 block truncate text-sm text-muted-foreground">
        <span className="capitalize">{d.tipo_inmueble}</span> en {d.barrio} · {formatCOP(d.precio_esperado)}
      </span>
      <span className="mt-1.5 block">
        <LeadStatus lead={lead} />
      </span>
    </button>
  );
}

// Estado como punto + texto — color solo en el punto
function LeadStatus({ lead }: { lead: LeadItem }) {
  let dot = "bg-muted-foreground";
  let txt = "";
  if (lead.kind === "pool") {
    dot = "bg-accent"; txt = "Disponible en pool";
  } else {
    const a = lead.data;
    if (a.estado === "asignado") { dot = "bg-primary"; txt = "Nuevo · requiere respuesta"; }
    else if (!a.due_diligence.documentos_completos) { dot = "bg-warning"; txt = "Verificando documentos"; }
    else {
      const c = a.listing ? datosMinimosCompletos(a.listing) : null;
      if (c && !c.ok) { dot = "bg-warning"; txt = "Ficha incompleta"; }
      else { dot = "bg-success"; txt = "Listo para publicar"; }
    }
  }
  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
      <span className={`h-1.5 w-1.5 rounded-full ${dot}`} aria-hidden />
      {txt}
    </span>
  );
}

// ── Detalle del lead ───────────────────────────────────────────────────────────

function LeadDetail({ lead, onBack }: { lead: LeadItem; onBack: () => void }) {
  const publicar = usePublicarAsignado();
  const aceptar  = useAceptarAsignado();
  const tomar    = useTomarDelPool();
  const [editandoFicha, setEditandoFicha] = useState(false);

  const d = lead.data;
  const asignado = lead.kind === "asignado" ? lead.data : null;
  const esNuevo = asignado?.estado === "asignado";
  const ddOk = asignado?.due_diligence.documentos_completos ?? false;
  const completeness = asignado?.listing ? datosMinimosCompletos(asignado.listing) : null;

  let nextStep: { texto: string; accion?: { label: string; run: () => void; pending: boolean } };
  if (lead.kind === "pool") {
    nextStep = {
      texto: "Inmueble en pool abierto: el primer agente que lo tome se lo queda.",
      accion: { label: tomar.isPending ? "Tomando…" : "Tomar inmueble", run: () => tomar.mutate(d.id), pending: tomar.isPending },
    };
  } else if (esNuevo) {
    nextStep = {
      texto: "Acepta este inmueble para iniciar la verificación de documentos.",
      accion: { label: aceptar.isPending ? "Aceptando…" : "Aceptar inmueble", run: () => aceptar.mutate(d.id), pending: aceptar.isPending },
    };
  } else if (!ddOk) {
    nextStep = { texto: "Verifica con el propietario los documentos pendientes." };
  } else if (completeness && !completeness.ok) {
    nextStep = { texto: "Documentos al día. Completa la ficha para poder publicar." };
  } else {
    nextStep = {
      texto: "Todo listo para enviar a revisión.",
      accion: { label: publicar.isPending ? "Publicando…" : "Publicar listing", run: () => publicar.mutate(d.id), pending: publicar.isPending },
    };
  }

  return (
    <div className="rounded-lg border border-border bg-surface">
      {/* Header */}
      <div className="flex items-center justify-between gap-3 border-b border-border px-5 py-4">
        <div className="flex min-w-0 items-center gap-3">
          <button
            onClick={onBack}
            className="shrink-0 rounded-md border border-border p-1.5 text-muted-foreground transition hover:text-foreground lg:hidden"
            aria-label="Volver a la lista"
          >
            <ArrowLeft className="h-4 w-4" />
          </button>
          <div className="min-w-0">
            <h2 className="truncate text-base font-semibold text-foreground">
              {asignado ? asignado.owner_nombre : "Inmueble del pool"}
            </h2>
            <p className="text-xs text-muted-foreground">
              {lead.kind === "pool" ? "Zona sin patrocinador" : "Asignado por tu zona"} · recibido {relativeTime(d.created_at)}
            </p>
          </div>
        </div>
        <LeadStatus lead={lead} />
      </div>

      {/* Siguiente paso */}
      <div className="flex flex-col gap-3 border-b border-border px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm text-foreground">{nextStep.texto}</p>
        {nextStep.accion && (
          <button
            onClick={nextStep.accion.run}
            disabled={nextStep.accion.pending}
            className="shrink-0 rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground transition hover:opacity-90 disabled:opacity-50"
          >
            {nextStep.accion.label}
          </button>
        )}
      </div>

      <div className="grid gap-6 px-5 py-5 md:grid-cols-2">
        {/* Propiedad */}
        <section>
          <h3 className="text-sm font-semibold text-foreground">Propiedad</h3>
          <div className="mt-2 text-2xl font-semibold tabular-nums text-foreground">
            {formatCOP(d.precio_esperado)}
            <span className="ml-2 text-sm font-normal capitalize text-muted-foreground">{d.operacion}</span>
          </div>
          <p className="mt-1 text-sm text-foreground">
            <span className="capitalize">{d.tipo_inmueble}</span> en {d.barrio}, {d.municipio}
          </p>
          {asignado && (
            <p className="mt-1 text-sm text-muted-foreground">
              {[
                asignado.declarado.area_m2 && `${asignado.declarado.area_m2} m²`,
                asignado.declarado.habitaciones != null && `${asignado.declarado.habitaciones} hab`,
                asignado.declarado.banos != null && `${asignado.declarado.banos} baños`,
              ].filter(Boolean).join(" · ") || "Sin características declaradas"}
            </p>
          )}
        </section>

        {/* Declarado por el propietario */}
        <section>
          <h3 className="text-sm font-semibold text-foreground">Declarado por el propietario</h3>
          {asignado ? (
            <ul className="mt-2 space-y-1.5">
              <DeclaradoItem label="Escritura" value={asignado.declarado.tiene_escritura} />
              <DeclaradoItem label="Predial al día" value={asignado.declarado.al_dia_predial} />
              <DeclaradoItem label="Administración al día" value={asignado.declarado.al_dia_administracion} />
              <DeclaradoItem label="Sin hipoteca" value={asignado.declarado.tiene_hipoteca == null ? null : !asignado.declarado.tiene_hipoteca} />
            </ul>
          ) : (
            <p className="mt-2 text-sm text-muted-foreground">
              Los datos del propietario se revelan al tomar el inmueble.
            </p>
          )}
        </section>

        {/* Due diligence interactiva: el realtor verifica item por item */}
        {asignado && !esNuevo && !ddOk && (
          <DDChecklistSection intakeId={asignado.id} />
        )}

        {asignado && ddOk && completeness && !completeness.ok && asignado.listing && (
          <section className="md:col-span-2">
            <div className="flex items-center justify-between gap-3">
              <h3 className="text-sm font-semibold text-foreground">Campos de la ficha por completar</h3>
              <button
                onClick={() => setEditandoFicha(true)}
                className="shrink-0 rounded-md bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground transition hover:opacity-90"
              >
                Completar ficha
              </button>
            </div>
            <ul className="mt-2 grid gap-1.5 sm:grid-cols-2">
              {completeness.faltan.map((f) => (
                <li key={f} className="text-sm capitalize text-muted-foreground">· {f}</li>
              ))}
            </ul>
          </section>
        )}
      </div>

      {editandoFicha && asignado?.listing && (
        <EditorFichaModal
          listingId={asignado.listing.id}
          initial={{
            titulo: asignado.listing.titulo ?? "",
            precio: asignado.listing.precio ?? undefined,
            area_m2: asignado.listing.area_m2 ?? undefined,
            habitaciones: asignado.listing.habitaciones ?? undefined,
            banos: asignado.listing.banos ?? undefined,
          }}
          onClose={() => setEditandoFicha(false)}
        />
      )}
    </div>
  );
}

// ── Editor de ficha (modal compartido: inbox + mis listings) ───────────────────

function EditorFichaModal({
  listingId,
  initial,
  onClose,
}: {
  listingId: string;
  initial: { titulo?: string; precio?: number; area_m2?: number; habitaciones?: number; banos?: number };
  onClose: () => void;
}) {
  const editar = useEditarListing();
  const [titulo, setTitulo] = useState(initial.titulo ?? "");
  const [precio, setPrecio] = useState(initial.precio ? String(initial.precio) : "");
  const [area, setArea] = useState(initial.area_m2 ? String(initial.area_m2) : "");
  const [hab, setHab] = useState(initial.habitaciones != null ? String(initial.habitaciones) : "");
  const [banos, setBanos] = useState(initial.banos != null ? String(initial.banos) : "");
  const [descripcion, setDescripcion] = useState("");
  const [fotos, setFotos] = useState<File[]>([]);
  const [err, setErr] = useState<string | null>(null);

  const guardar = async () => {
    const campos: import("@/lib/realtorApi").ListingPatch = {};
    if (titulo.trim() && titulo.trim() !== (initial.titulo ?? "")) campos.titulo = titulo.trim();
    if (precio && Number(precio) > 0 && Number(precio) !== initial.precio) campos.precio = Number(precio);
    if (area && Number(area) > 0 && Number(area) !== initial.area_m2) campos.area_m2 = Number(area);
    if (hab && Number(hab) !== initial.habitaciones) campos.habitaciones = Number(hab);
    if (banos && Number(banos) !== initial.banos) campos.banos = Number(banos);
    if (descripcion.trim()) campos.descripcion = descripcion.trim();

    if (Object.keys(campos).length === 0 && fotos.length === 0) {
      setErr("No hay cambios para guardar");
      return;
    }
    setErr(null);
    try {
      await editar.mutateAsync({ listingId, campos, fotos });
      onClose();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "No se pudo guardar");
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={onClose} role="dialog" aria-modal="true" aria-label="Editar ficha del listing">
      <div className="absolute inset-0 bg-black/40" />
      <div
        className="paper-theme relative w-full max-w-md rounded-lg border border-border bg-background p-5 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="text-base font-semibold text-foreground">Editar ficha</h3>

        <div className="mt-4 grid gap-3">
          <label className="grid gap-1 text-xs text-muted-foreground">
            Título del aviso
            <input value={titulo} onChange={(e) => setTitulo(e.target.value)} className={inputCls} placeholder="Apartamento en El Poblado con balcón" />
          </label>
          <div className="grid grid-cols-2 gap-3">
            <label className="grid gap-1 text-xs text-muted-foreground">
              Precio (COP)
              <input inputMode="numeric" value={precio} onChange={(e) => setPrecio(e.target.value.replace(/\D/g, ""))} className={inputCls} />
            </label>
            <label className="grid gap-1 text-xs text-muted-foreground">
              Área (m²)
              <input inputMode="numeric" value={area} onChange={(e) => setArea(e.target.value.replace(/\D/g, ""))} className={inputCls} />
            </label>
            <label className="grid gap-1 text-xs text-muted-foreground">
              Habitaciones
              <input inputMode="numeric" value={hab} onChange={(e) => setHab(e.target.value.replace(/\D/g, ""))} className={inputCls} />
            </label>
            <label className="grid gap-1 text-xs text-muted-foreground">
              Baños
              <input inputMode="numeric" value={banos} onChange={(e) => setBanos(e.target.value.replace(/\D/g, ""))} className={inputCls} />
            </label>
          </div>
          <label className="grid gap-1 text-xs text-muted-foreground">
            Descripción (opcional)
            <textarea value={descripcion} onChange={(e) => setDescripcion(e.target.value)} className={`${inputCls} min-h-20 resize-y`} />
          </label>
          <label className="grid gap-1 text-xs text-muted-foreground">
            Agregar fotos {fotos.length > 0 && `(${fotos.length} seleccionadas)`}
            <input
              type="file"
              accept="image/*"
              multiple
              onChange={(e) => setFotos(Array.from(e.target.files ?? []))}
              className="text-sm text-foreground file:mr-3 file:rounded-md file:border file:border-border file:bg-surface file:px-3 file:py-1.5 file:text-xs file:font-medium file:text-foreground"
            />
          </label>
        </div>

        {err && <p className="mt-3 text-sm text-danger">{err}</p>}

        <div className="mt-5 flex justify-end gap-2">
          <button onClick={onClose} className="rounded-md border border-border px-4 py-2 text-sm font-medium text-muted-foreground transition hover:text-foreground">
            Cancelar
          </button>
          <button
            onClick={guardar}
            disabled={editar.isPending}
            className="rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground transition hover:opacity-90 disabled:opacity-50"
          >
            {editar.isPending ? "Guardando…" : "Guardar"}
          </button>
        </div>
      </div>
    </div>
  );
}

// Etiquetas humanas de las claves del cuestionario legal
const DD_LABEL: Record<string, string> = {
  tiene_escritura: "Escritura",
  al_dia_predial: "Predial al día",
  al_dia_administracion: "Administración al día",
  tiene_hipoteca: "Hipoteca",
  en_propiedad_horizontal: "Propiedad horizontal",
  servicios_al_dia: "Servicios al día",
  estado_civil: "Estado civil",
  es_persona_juridica: "Persona jurídica",
};

function DDChecklistSection({ intakeId }: { intakeId: string }) {
  const { data, isLoading, isError } = useDueDiligence(intakeId);
  const verificar = useVerificarDDItem(intakeId);

  return (
    <section className="md:col-span-2">
      <h3 className="text-sm font-semibold text-foreground">Verificación de documentos</h3>
      <p className="mt-0.5 text-xs text-muted-foreground">
        Revisa cada punto con el propietario. Con todo verificado, el listing recibe el sello.
      </p>

      {isLoading && <Skeleton className="mt-3 h-32 rounded-lg" />}
      {isError && <p className="mt-3 text-sm text-danger">No se pudo cargar el checklist.</p>}

      {data && (
        <div className="mt-3 overflow-hidden rounded-lg border border-border bg-background">
          {data.items.map((item, i) => (
            <div
              key={item.id}
              className={`flex flex-col gap-2 px-4 py-2.5 sm:flex-row sm:items-center sm:justify-between ${i > 0 ? "border-t border-border/60" : ""}`}
            >
              <div className="min-w-0">
                <span className="text-sm text-foreground">{DD_LABEL[item.clave] ?? item.clave.replaceAll("_", " ")}</span>
                <span className="ml-2 text-xs text-muted-foreground">
                  declaró: {item.declarado === true ? "sí" : item.declarado === false ? "no" : item.declarado ?? "sin dato"}
                </span>
                {item.nota && <span className="ml-2 text-xs italic text-muted-foreground">“{item.nota}”</span>}
              </div>

              {item.estado === "pendiente" ? (
                <div className="flex shrink-0 gap-2">
                  <button
                    onClick={() => verificar.mutate({ itemId: item.id, estado: "verificado" })}
                    disabled={verificar.isPending}
                    className="rounded-md bg-primary px-3 py-1 text-xs font-semibold text-primary-foreground transition hover:opacity-90 disabled:opacity-50"
                  >
                    Verificado
                  </button>
                  <button
                    onClick={() => verificar.mutate({ itemId: item.id, estado: "rechazado" })}
                    disabled={verificar.isPending}
                    className="rounded-md border border-border px-3 py-1 text-xs font-medium text-muted-foreground transition hover:text-foreground disabled:opacity-50"
                  >
                    Rechazar
                  </button>
                </div>
              ) : (
                <span className={`inline-flex shrink-0 items-center gap-1.5 text-xs ${item.estado === "verificado" ? "text-success" : "text-danger"}`}>
                  <span className={`h-1.5 w-1.5 rounded-full ${item.estado === "verificado" ? "bg-success" : "bg-danger"}`} aria-hidden />
                  {item.estado === "verificado" ? "Verificado" : "Rechazado"}
                </span>
              )}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function DeclaradoItem({ label, value }: { label: string; value: boolean | null }) {
  return (
    <li className="flex items-center justify-between gap-2 text-sm">
      <span className="text-foreground">{label}</span>
      {value === true  && <span className="font-medium text-success">Sí</span>}
      {value === false && <span className="font-medium text-danger">No</span>}
      {value == null   && <span className="text-muted-foreground">Sin dato</span>}
    </li>
  );
}

// ══ TAB 2: Agenda — solicitudes de visita + interesados ════════════════════════

function AgendaTab() {
  const { data, isLoading, isError } = useAgenda();
  const actualizar = useActualizarVisita();

  if (isLoading) {
    return (
      <div className="space-y-6">
        <SkeletonRows n={3} />
        <Skeleton className="h-40 rounded-lg" />
      </div>
    );
  }
  if (isError || !data) return <SectionError msg="No se pudo cargar tu agenda." />;

  return <AgendaBody data={data} actualizar={actualizar} />;
}

type AgFiltro = "todas" | "pendiente" | "confirmada" | "realizada" | "cancelada";

function AgendaBody({ data, actualizar }: { data: Agenda; actualizar: ReturnType<typeof useActualizarVisita> }) {
  const [filtro, setFiltro] = useState<AgFiltro>("todas");
  const [verTodas, setVerTodas] = useState(false);
  const [verInteresados, setVerInteresados] = useState(false);

  const visitas = data.visitas;
  const nEstado = (e: VisitaSolicitud["estado"]) => visitas.filter((v) => v.estado === e).length;
  const filtradas =
    filtro === "todas" ? visitas
    : filtro === "cancelada" ? visitas.filter((v) => v.estado === "cancelada" || v.estado === "no_asistio")
    : visitas.filter((v) => v.estado === filtro);

  const LIMIT = 8;
  const visibles = verTodas ? filtradas : filtradas.slice(0, LIMIT);
  const chips: { id: AgFiltro; label: string; n: number }[] = [
    { id: "todas",      label: "Todas",       n: visitas.length },
    { id: "pendiente",  label: "Pendientes",  n: nEstado("pendiente") },
    { id: "confirmada", label: "Confirmadas", n: nEstado("confirmada") },
    { id: "realizada",  label: "Realizadas",  n: nEstado("realizada") },
    { id: "cancelada",  label: "Canceladas",  n: nEstado("cancelada") + nEstado("no_asistio") },
  ];

  const interesadosVis = verInteresados ? data.interesados : data.interesados.slice(0, LIMIT);

  return (
    <div className="space-y-10">
      <section>
        <SectionHeader title="Solicitudes de visita" count={visitas.length} sub="Personas que quieren ver tus inmuebles" />
        <div className="mb-3 flex flex-wrap gap-1.5">
          {chips.map((c) => (
            <button
              key={c.id}
              onClick={() => { setFiltro(c.id); setVerTodas(false); }}
              className={`rounded-full border px-3 py-1 text-xs font-medium transition ${
                filtro === c.id
                  ? "border-primary bg-primary/10 text-foreground"
                  : "border-border bg-surface text-muted-foreground hover:text-foreground"
              }`}
            >
              {c.label} <span className="opacity-60">{c.n}</span>
            </button>
          ))}
        </div>
        {filtradas.length === 0 ? (
          <EmptyState msg="No hay solicitudes con este filtro. Cuando alguien agende una visita desde el mapa, aparecerá aquí." />
        ) : (
          <>
            <div className="overflow-hidden rounded-lg border border-border bg-surface">
              {visibles.map((v, i) => (
                <VisitaRow
                  key={v.id}
                  visita={v}
                  first={i === 0}
                  pending={actualizar.isPending && actualizar.variables?.id === v.id}
                  onEstado={(estado, resultado) => actualizar.mutate({ id: v.id, estado, resultado })}
                />
              ))}
            </div>
            {filtradas.length > LIMIT && (
              <button
                onClick={() => setVerTodas((v) => !v)}
                className="mt-2 text-xs font-medium text-primary transition hover:underline"
              >
                {verTodas ? "Ver menos" : `Ver ${filtradas.length - LIMIT} más`}
              </button>
            )}
          </>
        )}
      </section>

      <section>
        <SectionHeader title="Interesados" count={data.interesados.length} sub="Usuarios que guardaron tus listings en favoritos" />
        {data.interesados.length === 0 ? (
          <EmptyState msg="Nadie ha guardado tus listings todavía." />
        ) : (
          <>
            <div className="overflow-hidden rounded-lg border border-border bg-surface">
              {interesadosVis.map((p, i) => (
                <div
                  key={`${p.email}-${i}`}
                  className={`flex items-center justify-between gap-3 px-4 py-3 ${i === 0 ? "" : "border-t border-border/70"}`}
                >
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium text-foreground">{p.nombre ?? "Usuario"}</div>
                    <div className="truncate text-xs text-muted-foreground">
                      {p.email} · guardó <span className="text-foreground">{p.listing_titulo}</span>
                    </div>
                  </div>
                  <span className="shrink-0 text-xs text-muted-foreground">{relativeTime(p.created_at)}</span>
                </div>
              ))}
            </div>
            {data.interesados.length > LIMIT && (
              <button
                onClick={() => setVerInteresados((v) => !v)}
                className="mt-2 text-xs font-medium text-primary transition hover:underline"
              >
                {verInteresados ? "Ver menos" : `Ver ${data.interesados.length - LIMIT} más`}
              </button>
            )}
          </>
        )}
      </section>
    </div>
  );
}

const VISITA_ESTADO: Record<VisitaSolicitud["estado"], { label: string; dot: string }> = {
  pendiente:  { label: "Pendiente",  dot: "bg-warning" },
  confirmada: { label: "Confirmada", dot: "bg-success" },
  realizada:  { label: "Realizada",  dot: "bg-muted-foreground" },
  cancelada:  { label: "Cancelada",  dot: "bg-muted-foreground" },
  no_asistio: { label: "No asistió", dot: "bg-danger" },
};

const RESULTADO_LABEL: Record<NonNullable<VisitaSolicitud["resultado"]>, string> = {
  interesado: "Interesado",
  oferta: "Hará oferta",
  descartado: "Descartado",
};

// Calificación del lead (Zillow paso 2) — etiquetas legibles por campo.
const LEAD_LABELS = {
  intencion:   { vivir: "Para vivir", invertir: "Inversión" },
  presupuesto: { "<200M": "Hasta $200M", "200-500M": "$200–500M", "500-1000M": "$500M–1.000M", ">1000M": "+$1.000M" },
  plazo:       { ya: "Compra ya", "1-3m": "1–3 meses", "3-6m": "3–6 meses", explorando: "Explorando" },
  credito:     { contado: "De contado", aprobado: "Crédito aprobado", en_tramite: "Crédito en trámite", no: "Sin crédito" },
} as const;

function leadPills(v: VisitaSolicitud): string[] {
  const out: string[] = [];
  if (v.intencion)   out.push(LEAD_LABELS.intencion[v.intencion]);
  if (v.presupuesto) out.push(LEAD_LABELS.presupuesto[v.presupuesto]);
  if (v.plazo)       out.push(LEAD_LABELS.plazo[v.plazo]);
  if (v.credito)     out.push(LEAD_LABELS.credito[v.credito]);
  return out;
}

function VisitaRow({
  visita: v,
  first,
  pending,
  onEstado,
}: {
  visita: VisitaSolicitud;
  first: boolean;
  pending: boolean;
  onEstado: (estado: "confirmada" | "realizada" | "cancelada" | "no_asistio", resultado?: "interesado" | "oferta" | "descartado") => void;
}) {
  const [pidiendoResultado, setPidiendoResultado] = useState(false);
  const { label, dot } = VISITA_ESTADO[v.estado];
  const fecha = v.fecha_visita
    ? new Date(v.fecha_visita).toLocaleString("es-CO", { weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" })
    : "Sin fecha propuesta";

  return (
    <div className={`flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center sm:justify-between ${first ? "" : "border-t border-border/70"}`}>
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <span className="font-medium text-foreground">{v.nombre}</span>
          {v.es_pro && (
            <span
              className="inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider"
              style={{ background: "#FCD116", color: "#111418" }}
              title="Lead de listing destacado — priorízalo"
            >
              🔥 Pro
            </span>
          )}
          {v.calificado && (
            <span
              className="inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider"
              style={{ background: "#E7F4EC", color: "#0A5C36" }}
              title="Lead calificado — dio presupuesto / plazo / crédito"
            >
              ✓ Calificado
            </span>
          )}
          {(() => {
            // SLA: Pro debe responderse en ≤4h; normal en ≤24h. horas_pendiente
            // es null cuando ya se atendió (estado != pendiente).
            const limite = v.es_pro ? 4 : 24;
            const vencido = v.horas_pendiente != null && v.horas_pendiente >= limite;
            if (!vencido) return null;
            return (
              <span
                className="inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-white"
                style={{ background: "#CE1126" }}
                title={`Sin responder hace ${v.horas_pendiente}h (SLA ${limite}h)`}
              >
                ⏰ Vencido
              </span>
            );
          })()}
          <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
            <span className={`h-1.5 w-1.5 rounded-full ${dot}`} aria-hidden />
            {label}
          </span>
        </div>
        <div className="mt-0.5 text-sm text-muted-foreground">
          {v.listing_titulo} · <span className="text-foreground">{fecha}</span>
        </div>
        <div className="mt-0.5 text-xs text-muted-foreground">
          {[v.telefono, v.email].filter(Boolean).join(" · ") || "Sin datos de contacto"}
          {v.mensaje && ` · "${v.mensaje}"`}
          {v.resultado && (
            <span className="ml-1 font-medium text-foreground">· {RESULTADO_LABEL[v.resultado]}</span>
          )}
        </div>
        {v.calificado && (
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {leadPills(v).map((p) => (
              <span key={p} className="inline-flex items-center rounded-md bg-muted px-2 py-0.5 text-[11px] font-medium text-foreground">
                {p}
              </span>
            ))}
          </div>
        )}
      </div>

      {(v.estado === "pendiente" || v.estado === "confirmada") && (
        pidiendoResultado ? (
          <div className="flex shrink-0 flex-wrap items-center gap-2">
            <span className="text-xs text-muted-foreground">¿Cómo terminó?</span>
            {(Object.keys(RESULTADO_LABEL) as (keyof typeof RESULTADO_LABEL)[]).map((r) => (
              <button
                key={r}
                onClick={() => { onEstado("realizada", r); setPidiendoResultado(false); }}
                disabled={pending}
                className="rounded-md border border-border px-3 py-1.5 text-xs font-semibold text-foreground transition hover:bg-muted/50 disabled:opacity-50"
              >
                {RESULTADO_LABEL[r]}
              </button>
            ))}
            <button
              onClick={() => setPidiendoResultado(false)}
              className="text-xs text-muted-foreground hover:text-foreground"
            >
              Volver
            </button>
          </div>
        ) : (
          <div className="flex shrink-0 gap-2">
            {v.estado === "pendiente" && (
              <button
                onClick={() => onEstado("confirmada")}
                disabled={pending}
                className="rounded-md bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground transition hover:opacity-90 disabled:opacity-50"
              >
                Confirmar
              </button>
            )}
            {v.estado === "confirmada" && (
              <>
                <button
                  onClick={() => setPidiendoResultado(true)}
                  disabled={pending}
                  className="rounded-md bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground transition hover:opacity-90 disabled:opacity-50"
                >
                  Marcar realizada
                </button>
                <button
                  onClick={() => onEstado("no_asistio")}
                  disabled={pending}
                  className="rounded-md border border-border px-3 py-1.5 text-xs font-medium text-muted-foreground transition hover:text-foreground disabled:opacity-50"
                >
                  No asistió
                </button>
              </>
            )}
            <button
              onClick={() => onEstado("cancelada")}
              disabled={pending}
              className="rounded-md border border-border px-3 py-1.5 text-xs font-medium text-muted-foreground transition hover:text-foreground disabled:opacity-50"
            >
              Cancelar
            </button>
          </div>
        )
      )}
    </div>
  );
}

// ══ TAB 3: Mis listings ════════════════════════════════════════════════════════

const ESTADO_FILTER_OPTIONS: { value: EstadoListing | "todos"; label: string }[] = [
  { value: "todos",       label: "Todos" },
  { value: "publicado",   label: "Publicado" },
  { value: "en_revision", label: "En revisión" },
  { value: "borrador",    label: "Borrador" },
  { value: "rechazado",   label: "Rechazado" },
  { value: "pausado",     label: "Pausado" },
  { value: "cerrado",     label: "Cerrado" },
];

function ListingsTab() {
  const { data, isLoading, isError } = useMisListings();
  const [filtro, setFiltro] = useState<EstadoListing | "todos">("todos");
  const [editando, setEditando] = useState<MiListing | null>(null);

  const visible = useMemo(
    () => (filtro === "todos" ? data ?? [] : (data ?? []).filter((l) => l.estado === filtro)),
    [data, filtro],
  );

  return (
    <section>
      <SectionHeader title="Mis listings" count={data?.length} />

      {!isLoading && data && data.length > 0 && (
        <div className="mb-4 flex flex-wrap gap-4 border-b border-border text-sm">
          {ESTADO_FILTER_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              onClick={() => setFiltro(opt.value)}
              className={`border-b-2 pb-2 transition ${
                filtro === opt.value
                  ? "border-primary font-semibold text-foreground"
                  : "border-transparent text-muted-foreground hover:text-foreground"
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
      )}

      {isLoading && <SkeletonRows n={3} />}

      {isError && <SectionError msg="No se pudieron cargar tus listings." />}

      {!isLoading && !isError && visible.length === 0 && (
        <EmptyState
          msg={
            filtro === "todos"
              ? "Aún no tienes listings. Publica tu primer inmueble desde el inbox."
              : `No tienes listings con estado "${filtro}".`
          }
        />
      )}

      {!isLoading && !isError && visible.length > 0 && (
        <div className="overflow-hidden rounded-lg border border-border bg-surface">
          {visible.map((l, i) => (
            <ListingRow key={l.id} listing={l} first={i === 0} onEditar={() => setEditando(l)} />
          ))}
        </div>
      )}

      {editando && (
        <EditorFichaModal
          listingId={editando.id}
          initial={{ titulo: editando.titulo, precio: editando.precio }}
          onClose={() => setEditando(null)}
        />
      )}
    </section>
  );
}

function ListingRow({ listing: l, first, onEditar }: { listing: MiListing; first: boolean; onEditar: () => void }) {
  const estado = ESTADO_META[l.estado];
  return (
    <div
      className={`flex flex-col gap-3 px-4 py-3 transition sm:flex-row sm:items-center sm:justify-between hover:bg-muted/30 ${
        first ? "" : "border-t border-border/70"
      }`}
    >
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="truncate text-sm font-medium text-foreground">{l.titulo}</span>
          <span className={`inline-flex shrink-0 items-center rounded-full border px-2 py-0.5 text-[11px] font-medium ${estado.badge}`}>
            {estado.label}
          </span>
        </div>
        <div className="mt-0.5 text-sm capitalize text-muted-foreground">
          {l.tipo_inmueble} · {l.operacion} · {l.barrio}
        </div>
        <div className="mt-0.5 text-xs text-muted-foreground">Actualizado {relativeTime(l.updated_at)}</div>
      </div>

      <div className="flex shrink-0 items-center gap-5 sm:gap-6">
        <div className="text-right text-base font-semibold tabular-nums text-foreground">
          {formatCOP(l.precio)}
        </div>
        {/* 30d en jerarquía fuerte, total como referencia — sin insinuar tendencia:
           no hay serie histórica para saber si esto sube o baja. */}
        <div className="text-right">
          <div className="text-sm font-semibold tabular-nums text-foreground">
            {l.estado === "publicado" ? l.vistas_30d.toLocaleString("es-CO") : "—"}
            <span className="ml-1 text-xs font-normal text-muted-foreground">30d</span>
          </div>
          <div className="text-xs text-muted-foreground">
            {l.vistas_total > 0 ? `${l.vistas_total.toLocaleString("es-CO")} totales` : "sin vistas aún"}
          </div>
        </div>
        {l.estado !== "cerrado" && (
          <button
            onClick={onEditar}
            className="shrink-0 rounded-md border border-border px-3 py-1.5 text-xs font-medium text-muted-foreground transition hover:text-foreground"
          >
            Editar
          </button>
        )}
      </div>
    </div>
  );
}

const ESTADO_META: Record<EstadoListing, { label: string; badge: string }> = {
  publicado:   { label: "Publicado",   badge: "border-success/30 bg-success/10 text-success" },
  en_revision: { label: "En revisión", badge: "border-warning/30 bg-warning/10 text-warning" },
  borrador:    { label: "Borrador",    badge: "border-border bg-muted text-muted-foreground" },
  pausado:     { label: "Pausado",     badge: "border-border bg-muted text-muted-foreground" },
  rechazado:   { label: "Rechazado",   badge: "border-danger/30 bg-danger/10 text-danger" },
  cerrado:     { label: "Cerrado",     badge: "border-border bg-muted text-muted-foreground" },
};

// ══ TAB: Resultados ════════════════════════════════════════════════════════════
// Panel client-facing (PDF panel-resultados-realtor.pdf, luz verde de Kathy).
// NO trae datos nuevos: reúne los MISMOS endpoints que Desempeño (/desempeno) e
// Inteligencia (/inteligencia/{zona}) en lenguaje llano para el realtor. La zona
// pagada manda: §2 y §3 hablan de la misma zona (la de mayor patrocinio).

const SUGERENCIAS: { titulo: string; detalle: string }[] = [
  {
    titulo: "Avisos cuando baja el precio de tus inmuebles",
    detalle:
      "Para que sepas de inmediato cuándo uno de tus inmuebles bajó de precio, sin tener que revisarlo tú mismo.",
  },
  {
    titulo: "Saber qué tanto interés real tiene cada inmueble",
    detalle:
      "Hoy solo sabemos quién lo vio. Falta saber quién lo comparó con otros o lo guardó como favorito — eso muestra quién está más cerca de decidirse.",
  },
  {
    titulo: "De dónde vienen tus clientes",
    detalle:
      "WhatsApp, Instagram, Google, un referido — para saber en qué vale la pena invertir más tu tiempo y tu plata.",
  },
  {
    titulo: "Clientes que perdiste por no responder a tiempo",
    detalle:
      "Cuántos clientes se te devolvieron por no contestar rápido, comparado con otros asesores de tu zona.",
  },
  {
    titulo: "Cuánta gente vive en tu zona",
    detalle:
      "Para que sepas si vale la pena pasar de barrio a comuna, según cuántas personas viven ahí.",
  },
];

const TIER_LABEL: Record<string, string> = {
  agente_premium: "Plan Agente Premium",
  comuna: "Plan Comuna",
  barrio: "Plan Barrio",
};

function planZona(z: RoiZona): string {
  const plan = z.tier ? TIER_LABEL[z.tier] ?? z.tier.replace(/_/g, " ") : "Patrocinio";
  return `${plan} · ${formatCOP(z.precio_mensual)}/mes`;
}

// walk_score (0–100) → etiqueta llana, como en el PDF ("Muy caminable")
function etiquetaCaminable(score: number | null | undefined): string {
  if (score == null) return "—";
  if (score >= 85) return "Muy caminable";
  if (score >= 65) return "Caminable";
  if (score >= 40) return "Algo caminable";
  return "Poco caminable";
}

function ResultadosTab() {
  const { data, isLoading, isError } = useDesempeno();
  // zonas viene ordenado por precio_mensual DESC → [0] es la zona pagada principal
  const zonaPagada = data?.zonas?.[0] ?? null;
  const { data: intel, isError: intelError } = useInteligenciaBarrio(
    zonaPagada?.zona_codigo ?? null,
    zonaPagada?.nivel,
  );

  if (isLoading) {
    return (
      <div className="space-y-6">
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
          {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-28 rounded-xl" />)}
        </div>
        <Skeleton className="h-64 rounded-xl" />
      </div>
    );
  }
  if (isError || !data) return <SectionError msg="No se pudo cargar tu panel de resultados." />;

  const mediana = data.mediana_horas_aceptar != null
    ? data.mediana_horas_aceptar < 48
      ? `${data.mediana_horas_aceptar} horas`
      : `${Math.round(data.mediana_horas_aceptar / 24)} días`
    : "—";
  const ofertasInteres = data.ofertas_90d + data.interesados_90d;
  const cs = data.calificacion_servicio;
  const csSub = cs.ranking
    ? `${cs.nota} · Puesto ${cs.ranking.posicion} de ${cs.ranking.total} por velocidad`
    : cs.nota;

  return (
    <div className="space-y-12">
      <header>
        <h1 className="text-xl font-semibold text-foreground">Tu panel de resultados</h1>
        <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
          Cómo te está yendo, cómo rinde tu zona pagada y qué dice el mercado. Cuéntanos qué te
          sirve más — eso decide qué construimos después.
        </p>
      </header>

      {/* ── §1 Cómo te está yendo ── */}
      <section>
        <BloqueHeader titulo="Cómo te está yendo" estado="disponible" sub="Últimos 3 meses" />
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
          <ResultCard
            label="Clientes que aceptaste"
            value={data.aceptados_90d}
            sub={`Te llegaron ${data.asignados_90d} y aceptaste ${data.aceptados_90d}`}
          />
          <ResultCard
            label="Qué tan rápido respondes"
            value={mediana}
            sub="Desde que te llega un cliente hasta que lo aceptas"
          />
          <ResultCard
            label="Personas que vieron tus inmuebles"
            value={data.vistas_30d.toLocaleString("es-CO")}
            sub="En los últimos 30 días"
          />
          <ResultCard
            label="Asistencia a las visitas"
            value={data.show_rate != null ? `${Math.round(data.show_rate * 100)}%` : "—"}
            sub={`${data.visitas_realizadas_90d} sí llegaron y ${data.visitas_no_show_90d} no llegaron`}
          />
          <ResultCard
            label="Visitas con oferta o interés real"
            value={ofertasInteres}
            sub={`${data.ofertas_90d} ofertas y ${data.interesados_90d} personas interesadas`}
          />
          <ResultCard
            label="Tu calificación de servicio"
            value={cs.mediana_horas_respuesta != null ? `${cs.grado} · ${cs.mediana_horas_respuesta}h` : cs.grado}
            sub={csSub}
          />
        </div>
      </section>

      {/* ── §2 Resultados en tu zona pagada ── */}
      <section>
        <BloqueHeader titulo="Resultados en tu zona pagada" estado="disponible" />
        {!zonaPagada ? (
          <EmptyState msg="Cuando actives una zona pagada, aquí verás cuánto te cuesta cada cliente y cómo avanzan tus inmuebles en esa zona." />
        ) : (
          <div className="rounded-xl border border-border bg-surface p-5 sm:p-6">
            <div>
              <h3 className="text-base font-semibold capitalize text-foreground">
                {zonaPagada.zona_nombre}
                <span className="ml-2 text-sm font-normal capitalize text-muted-foreground">{zonaPagada.nivel}</span>
              </h3>
              <p className="mt-0.5 text-xs text-muted-foreground">{planZona(zonaPagada)}</p>
            </div>

            <div className="mt-5 grid grid-cols-1 gap-5 sm:grid-cols-3">
              <BigNumber
                value={zonaPagada.costo_por_intake != null ? formatCOP(zonaPagada.costo_por_intake) : "—"}
                sub="Costo por cada cliente conseguido"
              />
              <BigNumber
                value={zonaPagada.vistas_30d.toLocaleString("es-CO")}
                sub="Visitas a tus inmuebles este mes"
              />
              <BigNumber
                value={zonaPagada.intakes_mes}
                sub="Inmuebles nuevos este mes"
              />
            </div>

            <div className="mt-6 space-y-2">
              {[
                { label: "Llegaron",  value: zonaPagada.intakes_mes },
                { label: "Tomados",   value: zonaPagada.tomados_mes },
                { label: "Publicados", value: zonaPagada.publicados_total },
                { label: "Cerrados",  value: zonaPagada.cerrados_total },
              ].map(({ label, value }) => {
                const max = Math.max(zonaPagada.intakes_mes, 1);
                return (
                  <div key={label} className="flex items-center gap-3">
                    <span className="w-24 shrink-0 text-sm text-muted-foreground">{label}</span>
                    <div className="h-2 flex-1 overflow-hidden rounded-full bg-muted">
                      <div className="h-full rounded-full bg-primary" style={{ width: `${Math.min(100, (value / max) * 100)}%` }} />
                    </div>
                    <span className="w-8 shrink-0 text-right text-sm font-semibold tabular-nums text-foreground">{value}</span>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </section>

      {/* ── §3 Información del mercado ── */}
      <section>
        <BloqueHeader titulo="Información del mercado" estado="disponible" />
        {!zonaPagada ? (
          <EmptyState msg="La información de mercado aparece según tu zona pagada." />
        ) : intelError || !intel ? (
          <EmptyState msg="Aún no tenemos datos de mercado para esta zona." />
        ) : (
          <div className="space-y-6">
            <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
              {intel.nombre ?? zonaPagada.zona_nombre}
            </h3>

            <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
              <MercadoCol titulo="Venta" filas={[
                ["Precio por metro cuadrado", intel.mercado.precio_m2_cop ? formatCOP(intel.mercado.precio_m2_cop) : "—"],
                ["Ganancia anual", intel.mercado.yield_bruto_pct != null ? `${intel.mercado.yield_bruto_pct.toFixed(1)}%` : "—"],
                ["Facilidad de venta", intel.liquidez.categoria ?? "—"],
                ["Tiempo estimado para vender", intel.liquidez.tiempo_estimado_venta ?? "—"],
              ]} />
              <MercadoCol titulo="Arriendo de largo plazo" filas={[
                ["Arriendo típico", intel.mercado.arriendo_p50_cop ? formatCOP(intel.mercado.arriendo_p50_cop) : "—"],
                ["Ganancia anual", intel.mercado.yield_bruto_pct != null ? `${intel.mercado.yield_bruto_pct.toFixed(1)}%` : "—"],
                ["Años para recuperar la inversión", intel.mercado.anos_recupero != null ? intel.mercado.anos_recupero.toFixed(1) : "—"],
              ]} />
              <MercadoCol titulo="Alquiler por días (tipo Airbnb)" filas={[
                ["Días ocupado", intel.airbnb.ocupacion_pct != null ? `${Math.round(intel.airbnb.ocupacion_pct)}%` : "—"],
                ["Precio promedio por noche", intel.airbnb.adr_cop ? formatCOP(intel.airbnb.adr_cop) : "—"],
                ["Ganancia anual", intel.airbnb.yield_airbnb_pct != null ? `${intel.airbnb.yield_airbnb_pct.toFixed(1)}%` : "—"],
              ]} />
            </div>

            <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
              <MercadoCol titulo="Seguridad" filas={[
                ["Qué tan segura es", intel.seguridad.score != null ? `${intel.seguridad.score} de 100` : "—"],
                ["Cómo va cambiando", intel.seguridad.tendencia ?? "—"],
              ]} />
              <MercadoCol titulo="Ubicación" filas={[
                ["Distancia al metro", intel.conectividad.dist_metro_km != null ? `${intel.conectividad.dist_metro_km.toFixed(1)} km` : "—"],
                ["Qué tan caminable es", etiquetaCaminable(intel.conectividad.walk_score)],
                ["Colegios cerca", intel.conectividad.n_colegios_1km ?? "—"],
              ]} />
              <MercadoCol titulo="Valorización" filas={[
                ["Cuánto subió de precio este año", intel.valorizacion.var_anual_pct != null ? `${intel.valorizacion.var_anual_pct > 0 ? "+" : ""}${intel.valorizacion.var_anual_pct.toFixed(1)}%` : "—"],
                ["Lo que se espera que suba en 5 años", intel.valorizacion.proyeccion_5anos_pct != null ? `${intel.valorizacion.proyeccion_5anos_pct > 0 ? "+" : ""}${intel.valorizacion.proyeccion_5anos_pct.toFixed(0)}%` : "—"],
              ]} />
            </div>

            <p className="text-xs text-muted-foreground">
              Esta información se actualiza cada semana o cada mes, no al instante.
            </p>
          </div>
        )}
      </section>

      {/* ── §4 Ideas para más adelante ── */}
      <section>
        <BloqueHeader titulo="Ideas para más adelante" estado="pendiente" />
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {SUGERENCIAS.map((s) => (
            <div key={s.titulo} className="rounded-xl border border-dashed border-border bg-surface/50 p-5">
              <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Sugerencia</span>
              <h4 className="mt-1.5 text-sm font-semibold text-foreground">{s.titulo}</h4>
              <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{s.detalle}</p>
            </div>
          ))}
        </div>
        <p className="mt-4 text-xs text-muted-foreground">
          Estas ideas todavía no existen. Cuéntanos qué te gustaría ver primero.
        </p>
      </section>
    </div>
  );
}

// Encabezado de bloque con sello "YA DISPONIBLE" / "AÚN NO EXISTEN"
function BloqueHeader({ titulo, estado, sub }: { titulo: string; estado: "disponible" | "pendiente"; sub?: string }) {
  return (
    <div className="mb-4 flex flex-wrap items-center gap-x-3 gap-y-1">
      <h2 className="text-lg font-semibold text-foreground">{titulo}</h2>
      {estado === "disponible" ? (
        <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-primary">
          Ya disponible
        </span>
      ) : (
        <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          Aún no existen
        </span>
      )}
      {sub && <span className="w-full text-xs text-muted-foreground sm:w-auto">{sub}</span>}
    </div>
  );
}

// Tarjeta de estadística cálida (número grande + explicación en llano)
function ResultCard({ label, value, sub }: { label: string; value: string | number; sub: string }) {
  return (
    <div className="rounded-xl border border-border bg-surface p-5">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-2 text-3xl font-semibold tabular-nums text-foreground">{value}</div>
      <div className="mt-1.5 text-xs leading-relaxed text-muted-foreground">{sub}</div>
    </div>
  );
}

function BigNumber({ value, sub }: { value: string | number; sub: string }) {
  return (
    <div>
      <div className="text-3xl font-semibold tabular-nums text-foreground">{value}</div>
      <div className="mt-1 text-xs leading-relaxed text-muted-foreground">{sub}</div>
    </div>
  );
}

// Columna de mercado: título + filas [etiqueta, valor]
function MercadoCol({ titulo, filas }: { titulo: string; filas: [string, string | number][] }) {
  return (
    <div className="rounded-xl border border-border bg-surface p-5">
      <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{titulo}</h4>
      <dl className="mt-3 space-y-3">
        {filas.map(([label, value]) => (
          <div key={label} className="flex items-baseline justify-between gap-3">
            <dt className="text-xs text-muted-foreground">{label}</dt>
            <dd className="shrink-0 text-sm font-semibold tabular-nums text-foreground">{value}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

// ══ TAB 3: Desempeño ═══════════════════════════════════════════════════════════

function DesempenoTab() {
  const { data, isLoading, isError } = useDesempeno();

  if (isLoading) {
    return (
      <div className="space-y-6">
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-24 rounded-lg" />)}
        </div>
        <Skeleton className="h-64 rounded-lg" />
      </div>
    );
  }

  if (isError || !data) {
    return <SectionError msg="No se pudo cargar tu desempeño." />;
  }

  const mediana = data.mediana_horas_aceptar != null
    ? data.mediana_horas_aceptar < 48
      ? `${data.mediana_horas_aceptar} h`
      : `${Math.round(data.mediana_horas_aceptar / 24)} d`
    : "—";

  return (
    <div className="space-y-10">
      <section>
        <SectionHeader title="Tu desempeño" sub="Últimos 90 días" />
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
          <RingStat
            label="Tasa de aceptación"
            percent={data.tasa_aceptacion != null ? Math.round(data.tasa_aceptacion * 100) : null}
            sub={`${data.aceptados_90d} de ${data.asignados_90d} asignados`}
          />
          <StatTile
            label="Velocidad de respuesta"
            value={mediana}
            sub="mediana hasta aceptar"
          />
          <StatTile
            label="Vistas en 30 días"
            value={data.vistas_30d.toLocaleString("es-CO")}
            sub={`${data.vistas_total.toLocaleString("es-CO")} históricas`}
          />
          <RingStat
            label="Asistencia a visitas"
            percent={data.show_rate != null ? Math.round(data.show_rate * 100) : null}
            sub={`${data.visitas_realizadas_90d} realizadas · ${data.visitas_no_show_90d} plantones`}
          />
          <StatTile
            label="Visitas con oferta"
            value={data.ofertas_90d}
            sub={`${data.interesados_90d} más quedaron interesados`}
          />
          <StatTile
            label="Cierres"
            value={data.zonas.reduce((s, z) => s + z.cerrados_total, 0)}
            sub="en zonas patrocinadas"
          />
        </div>
        <p className="mt-3 text-xs text-muted-foreground">
          Los asignados no aceptados a tiempo pueden volver al pool. Responder rápido protege tu zona.
        </p>
      </section>

      <section>
        <SectionHeader title="Retorno de tus zonas patrocinadas" sub="Este mes" />
        {data.zonas.length === 0 ? (
          <EmptyState msg="No tienes zonas patrocinadas activas. Patrocina un barrio o comuna para recibir inmuebles con prioridad." />
        ) : (
          <div className="grid gap-4 lg:grid-cols-2">
            {data.zonas.map((z) => <RoiZonaCard key={z.zona_codigo} zona={z} />)}
          </div>
        )}
      </section>
    </div>
  );
}

function StatTile({ label, value, sub }: { label: string; value: string | number; sub: string }) {
  return (
    <div className="rounded-lg border border-border bg-surface p-4">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-1 text-2xl font-semibold tabular-nums text-foreground">{value}</div>
      <div className="mt-0.5 text-xs text-muted-foreground">{sub}</div>
    </div>
  );
}

// unit: "%" para tasas reales 0–100 (asistencia, ocupación); "/100" para scores
// (evita mostrar un score como si fuera un porcentaje — no es lo mismo).
function RingStat({ label, percent, sub, unit = "%" }: { label: string; percent: number | null; sub: string; unit?: "%" | "/100" }) {
  const value = percent ?? 0;
  const data = [{ value }, { value: Math.max(0, 100 - value) }];

  return (
    <div className="flex items-center gap-3 rounded-lg border border-border bg-surface p-4">
      <div className="relative h-14 w-14 shrink-0">
        <PieChart width={56} height={56}>
          <Pie data={data} dataKey="value" innerRadius={20} outerRadius={28} startAngle={90} endAngle={-270} stroke="none">
            <Cell fill="#0F8A4F" />
            <Cell fill="var(--muted)" />
          </Pie>
        </PieChart>
        <div className={`absolute inset-0 flex items-center justify-center font-semibold tabular-nums text-foreground ${unit === "/100" ? "text-[10px]" : "text-xs"}`}>
          {percent != null ? `${percent}${unit}` : "—"}
        </div>
      </div>
      <div>
        <div className="text-xs text-muted-foreground">{label}</div>
        <div className="mt-0.5 text-xs text-muted-foreground">{sub}</div>
      </div>
    </div>
  );
}

function RoiZonaCard({ zona: z }: { zona: RoiZona }) {
  const embudo = [
    { label: "Inmuebles en la zona", value: z.intakes_mes },
    { label: "Tomados por ti",       value: z.tomados_mes },
    { label: "Publicados",           value: z.publicados_total },
    { label: "Cerrados",             value: z.cerrados_total },
  ];
  const max = Math.max(z.intakes_mes, 1);

  return (
    <div className="rounded-lg border border-border bg-surface p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-foreground">
            {z.zona_nombre}
            <span className="ml-2 text-xs font-normal capitalize text-muted-foreground">{z.nivel}</span>
          </h3>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Patrocinio {formatCOP(z.precio_mensual)}/mes
          </p>
        </div>
        <div className="shrink-0 text-right">
          <div className="text-xs text-muted-foreground">Costo por inmueble</div>
          <div className="text-lg font-semibold tabular-nums text-foreground">
            {z.costo_por_intake != null ? formatCOP(z.costo_por_intake) : "—"}
          </div>
        </div>
      </div>

      <div className="mt-4 space-y-2">
        {embudo.map(({ label, value }) => (
          <div key={label} className="flex items-center gap-3">
            <span className="w-40 shrink-0 text-xs text-muted-foreground">{label}</span>
            <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
              <div
                className="h-full rounded-full bg-primary"
                style={{ width: `${Math.min(100, (value / max) * 100)}%` }}
              />
            </div>
            <span className="w-8 shrink-0 text-right text-sm font-medium tabular-nums text-foreground">{value}</span>
          </div>
        ))}
      </div>

      <p className="mt-4 border-t border-border pt-3 text-xs text-muted-foreground">
        <span className="font-medium tabular-nums text-foreground">{z.vistas_30d.toLocaleString("es-CO")}</span>{" "}
        vistas a tus listings de esta zona en los últimos 30 días
      </p>
    </div>
  );
}

// ══ TAB 4: Inteligencia ════════════════════════════════════════════════════════
// Regla de visualización (consistente con Desempeño): scores y tasas acotados
// 0–100 (score de inversión, liquidez, seguridad, ocupación, walk/transit score)
// van en RingStat. Dinero, conteos, distancias y % no acotados (yields,
// valorización) van en StatTile — un ring casi vacío para un yield del 6%
// sería más confuso que informativo.

function InteligenciaTab() {
  const { data: perfil } = useRealtorPerfil();
  const { data: listings } = useMisListings();

  const zonas = useMemo(() => {
    const map = new Map<string, { nombre: string; nivel: ZonaNivel }>();
    // zonas patrocinadas primero: son las que sí tienen datos resolubles
    // (comuna/barrio con cd_comuna/id real), vs. el barrio-texto libre del listing.
    for (const z of perfil?.zonas_patrocinadas ?? []) map.set(z.codigo, { nombre: z.nombre, nivel: z.nivel });
    for (const l of listings ?? []) {
      if (l.barrio) {
        const code = l.barrio.toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "");
        if (!map.has(code)) map.set(code, { nombre: l.barrio, nivel: "barrio" });
      }
    }
    return Array.from(map.entries()).map(([codigo, v]) => ({ codigo, nombre: v.nombre, nivel: v.nivel }));
  }, [perfil, listings]);

  const [selectedZona, setSelectedZona] = useState<string | null>(null);
  const activeZona = selectedZona ?? zonas[0]?.codigo ?? null;
  const activeNivel = zonas.find((z) => z.codigo === activeZona)?.nivel ?? "barrio";

  const { data: intel, isLoading, isError } = useInteligenciaBarrio(activeZona, activeNivel);

  return (
    <section>
      <SectionHeader title="Inteligencia de barrio" />

      {zonas.length === 0 ? (
        <EmptyState msg="Agrega listings o patrocina una zona para ver métricas de mercado." />
      ) : (
        <>
          <div className="mb-4">
            <select
              value={activeZona ?? ""}
              onChange={(e) => setSelectedZona(e.target.value || null)}
              className={inputCls}
              style={{ maxWidth: 260 }}
              aria-label="Seleccionar zona de análisis"
            >
              {zonas.map((z) => (
                <option key={z.codigo} value={z.codigo}>{z.nombre}</option>
              ))}
            </select>
          </div>

          {isLoading && (
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
              {Array.from({ length: 4 }).map((_, i) => (
                <Skeleton key={i} className="h-24 rounded-lg" />
              ))}
            </div>
          )}

          {isError && <SectionError msg="No se pudo cargar la inteligencia del barrio." />}

          {!isLoading && !isError && intel && (
            <div className="space-y-6">
              <div className="rounded-lg border-l-4 pl-4" style={{ borderColor: intel.color_hex ?? "#888780" }}>
                <IntelGroup title="Score de inversión por horizonte">
                  <RingStat label="Corto plazo" percent={intel.scores.corto} sub={intel.scores.cat_corto ?? "Airbnb"} unit="/100" />
                  <RingStat label="Mediano plazo" percent={intel.scores.mediano} sub={intel.scores.cat_mediano ?? "renta media"} unit="/100" />
                  <RingStat label="Largo plazo" percent={intel.scores.largo} sub={intel.scores.cat_largo ?? "renta larga"} unit="/100" />
                  <StatTile label="Perfil recomendado" value={intel.scores.perfil_recomendado ?? "—"} sub="mejor uso de la zona" />
                </IntelGroup>
              </div>

              <IntelGroup title="Venta">
                <RingStat label="Liquidez" percent={intel.liquidez.score} sub={intel.liquidez.categoria ?? "facilidad de venta"} unit="/100" />
                <StatTile label="Mediana m² venta" value={intel.mercado.precio_m2_cop ? formatCOP(intel.mercado.precio_m2_cop) : "—"} sub="precio por m²" />
                <StatTile label="Tiempo estimado de venta" value={intel.liquidez.tiempo_estimado_venta ?? "—"} sub="en el mercado" />
              </IntelGroup>

              <IntelGroup title="Renta larga" dense>
                <StatTile label="Canon mediano" value={intel.mercado.arriendo_p50_cop ? formatCOP(intel.mercado.arriendo_p50_cop) : "—"} sub="COP / mes" />
                <StatTile label="Yield bruto" value={intel.mercado.yield_bruto_pct != null ? `${intel.mercado.yield_bruto_pct.toFixed(1)}%` : "—"} sub="anual sobre precio" />
                <StatTile label="Años de recupero" value={intel.mercado.anos_recupero != null ? intel.mercado.anos_recupero.toFixed(1) : "—"} sub="capital vía arriendo" />
              </IntelGroup>

              <IntelGroup title="Renta media (nómadas 1-3 meses)" dense>
                <StatTile label="Precio mediano" value={intel.mercado.precio_renta_media_p50 ? formatCOP(intel.mercado.precio_renta_media_p50) : "—"} sub="COP / mes" />
                <StatTile label="Yield renta media" value={intel.mercado.yield_renta_media_pct != null ? `${intel.mercado.yield_renta_media_pct.toFixed(1)}%` : "—"} sub="anual" />
                <StatTile label="Listings activos" value={intel.mercado.n_listings_renta_media ?? "—"} sub="oferta actual" />
                <StatTile label="Premium vs renta larga" value={intel.mercado.premium_vs_largo_pct != null ? `+${intel.mercado.premium_vs_largo_pct.toFixed(0)}%` : "—"} sub="sobre canon tradicional" />
              </IntelGroup>

              <IntelGroup title="Renta corta (Airbnb)">
                <RingStat label="Ocupación" percent={intel.airbnb.ocupacion_pct != null ? Math.round(intel.airbnb.ocupacion_pct) : null} sub="promedio zona" />
                <StatTile label="Tarifa noche" value={intel.airbnb.adr_cop ? formatCOP(intel.airbnb.adr_cop) : "—"} sub="ADR promedio" />
                <StatTile label="Yield Airbnb" value={intel.airbnb.yield_airbnb_pct != null ? `${intel.airbnb.yield_airbnb_pct.toFixed(1)}%` : "—"} sub="anual" />
                <StatTile label="Listings activos" value={intel.airbnb.n_listings ?? "—"} sub="oferta actual" />
              </IntelGroup>

              <IntelGroup title="Seguridad">
                <RingStat label="Score seguridad" percent={intel.seguridad.score} sub={intel.seguridad.categoria ?? "percepción residente"} unit="/100" />
                <StatTile label="Tendencia" value={intel.seguridad.tendencia ?? "—"} sub="últimos periodos" />
                {intel.seguridad.nota && <StatTile label="Nota" value="" sub={intel.seguridad.nota} />}
              </IntelGroup>

              <IntelGroup title="Conectividad">
                <StatTile label="Al metro" value={intel.conectividad.dist_metro_km != null ? `${intel.conectividad.dist_metro_km.toFixed(1)} km` : "—"} sub="distancia" />
                <RingStat label="Caminabilidad" percent={intel.conectividad.walk_score} sub="walk score" unit="/100" />
                <RingStat label="Transporte público" percent={intel.conectividad.transit_score} sub="transit score" unit="/100" />
                <StatTile label="Colegios a 1km" value={intel.conectividad.n_colegios_1km ?? "—"} sub="cercanos" />
              </IntelGroup>

              <IntelGroup title="Valorización" dense>
                <StatTile label="Variación anual" value={intel.valorizacion.var_anual_pct != null ? `${intel.valorizacion.var_anual_pct.toFixed(1)}%` : "—"} sub={intel.valorizacion.tendencia ?? "histórico"} />
                <StatTile label="Proyección 3 años" value={intel.valorizacion.proyeccion_3anos_pct != null ? `${intel.valorizacion.proyeccion_3anos_pct.toFixed(0)}%` : "—"} sub="estimado" />
                <StatTile label="Proyección 5 años" value={intel.valorizacion.proyeccion_5anos_pct != null ? `${intel.valorizacion.proyeccion_5anos_pct.toFixed(0)}%` : "—"} sub="estimado" />
              </IntelGroup>

              <p className="text-xs text-muted-foreground">
                Las medianas son nominales; deflactar con IPC (DANE) antes de comparar períodos.
              </p>
            </div>
          )}
        </>
      )}
    </section>
  );
}

// ── Atoms ──────────────────────────────────────────────────────────────────────

function SectionHeader({ title, count, sub }: { title: string; count?: number; sub?: string }) {
  return (
    <div className="mb-4">
      <h2 className="text-base font-semibold text-foreground">
        {title}
        {count != null && <span className="ml-2 font-normal text-muted-foreground">({count})</span>}
      </h2>
      {sub && <p className="text-xs text-muted-foreground">{sub}</p>}
    </div>
  );
}

// dense=false (default) para grupos con algún RingStat: la tarjeta horizontal
// (donut + texto) necesita más ancho que un StatTile — 3 columnas es la misma
// densidad ya probada en Desempeño. dense=true para grupos solo de StatTile.
function IntelGroup({
  title,
  dense = false,
  children,
}: {
  title: string;
  dense?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div>
      <h3 className="mb-2 text-sm font-semibold text-foreground">{title}</h3>
      <div className={`grid grid-cols-2 gap-4 ${dense ? "sm:grid-cols-4" : "sm:grid-cols-3"}`}>{children}</div>
    </div>
  );
}

function EmptyState({ msg }: { msg: string }) {
  return (
    <div className="rounded-lg border border-dashed border-border px-6 py-10 text-center">
      <p className="mx-auto max-w-sm text-sm text-muted-foreground">{msg}</p>
    </div>
  );
}

function SectionError({ msg }: { msg: string }) {
  return (
    <div className="rounded-lg border border-danger/30 bg-danger/10 px-4 py-3 text-sm text-danger">
      {msg}
    </div>
  );
}

function SkeletonRows({ n }: { n: number }) {
  return (
    <div className="space-y-2">
      {Array.from({ length: n }).map((_, i) => (
        <Skeleton key={i} className="h-16 w-full rounded-lg" />
      ))}
    </div>
  );
}

// ── Utils ──────────────────────────────────────────────────────────────────────

const inputCls =
  "rounded-md border border-border bg-surface px-3 py-2 text-sm text-foreground outline-none transition placeholder:text-muted-foreground focus:border-primary focus:ring-2 focus:ring-primary/20 w-full";

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const min = Math.floor(diff / 60_000);
  if (min < 1)  return "ahora";
  if (min < 60) return `hace ${min}m`;
  const h = Math.floor(min / 60);
  if (h < 24)   return `hace ${h}h`;
  const d = Math.floor(h / 24);
  return `hace ${d}d`;
}

// ── Horario / disponibilidad del agente (slots de visita, sin Google) ─────────
// ══ TAB 6: Configuración — horario de visitas + zonas patrocinadas ═════════════

type ConfigSub = "perfil" | "horario" | "zonas";

function ConfiguracionTab() {
  const [sub, setSub] = useState<ConfigSub>("perfil");
  const subTabs: { id: ConfigSub; label: string }[] = [
    { id: "perfil",  label: "Perfil público" },
    { id: "horario", label: "Horario de visitas" },
    { id: "zonas",   label: "Zonas patrocinadas" },
  ];

  return (
    <section>
      <SectionHeader title="Configuración" />
      <div className="mb-6 flex gap-2 border-b border-border">
        {subTabs.map(({ id, label }) => (
          <button
            key={id}
            onClick={() => setSub(id)}
            aria-current={sub === id ? "page" : undefined}
            className={`shrink-0 border-b-2 px-1 pb-2.5 text-sm transition ${
              sub === id
                ? "border-primary font-semibold text-foreground"
                : "border-transparent font-medium text-muted-foreground hover:text-foreground"
            }`}
          >
            {label}
          </button>
        ))}
      </div>
      {sub === "perfil" && <PerfilTab />}
      {sub === "horario" && <DisponibilidadTab />}
      {sub === "zonas" && <ZonasCompraTab />}
    </section>
  );
}

// Perfil público que el agente escribe de sí mismo: foto (R2) + descripción.
// Se muestra en el popup del directorio /agentes junto a su actividad auto-agregada.
function PerfilTab() {
  const { data: perfil } = useRealtorPerfil();
  const qc = useQueryClient();
  const [bio, setBio] = useState("");
  const [saving, setSaving] = useState(false);
  const [subiendo, setSubiendo] = useState(false);
  const [initd, setInitd] = useState(false);

  useEffect(() => {
    if (perfil && !initd) { setBio(perfil.bio ?? ""); setInitd(true); }
  }, [perfil, initd]);

  async function guardarBio() {
    setSaving(true);
    try {
      await realtorApi.editarPerfil(bio.trim());
      await qc.invalidateQueries({ queryKey: ["realtor", "perfil"] });
      toast.success("Perfil actualizado");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "No se pudo guardar");
    } finally {
      setSaving(false);
    }
  }

  async function subirFoto(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setSubiendo(true);
    try {
      await realtorApi.subirFotoPerfil(file);
      await qc.invalidateQueries({ queryKey: ["realtor", "perfil"] });
      toast.success("Foto actualizada");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "No se pudo subir la foto");
    } finally {
      setSubiendo(false);
      e.target.value = "";
    }
  }

  const initials = perfil?.nombre.split(/\s+/).map((s) => s[0]).slice(0, 2).join("").toUpperCase();

  return (
    <div className="max-w-xl">
      <p className="mb-5 text-sm text-muted-foreground">
        Así te ven los visitantes en tu perfil público del directorio. Tus propiedades y cierres se muestran solos.
      </p>

      {/* Foto */}
      <div className="mb-6 flex items-center gap-4">
        <div className="grid h-20 w-20 shrink-0 place-items-center overflow-hidden rounded-2xl border border-border bg-surface text-lg font-semibold text-foreground">
          {perfil?.avatar
            ? <img src={perfil.avatar} alt={perfil.nombre} className="h-full w-full object-cover" />
            : initials}
        </div>
        <label className="cursor-pointer rounded-lg border border-border px-4 py-2 text-sm font-medium text-foreground transition hover:bg-surface">
          {subiendo ? "Subiendo…" : "Cambiar foto"}
          <input type="file" accept="image/*" onChange={subirFoto} disabled={subiendo} className="hidden" />
        </label>
      </div>

      {/* Bio */}
      <label className="mb-1.5 block text-sm font-medium text-foreground">Descripción</label>
      <textarea
        value={bio}
        onChange={(e) => setBio(e.target.value)}
        maxLength={2000}
        rows={6}
        placeholder="Cuéntales a los clientes sobre ti: tu experiencia, las zonas que conoces, tu estilo de trabajo."
        className="w-full resize-none rounded-lg border border-border bg-background p-3 text-sm text-foreground outline-none focus:border-primary"
      />
      <div className="mt-1 text-right text-xs text-muted-foreground">{bio.length}/2000</div>
      <button
        onClick={guardarBio}
        disabled={saving}
        className="mt-2 rounded-lg bg-primary px-5 py-2 text-sm font-semibold text-primary-foreground transition hover:opacity-90 disabled:opacity-60"
      >
        {saving ? "Guardando…" : "Guardar"}
      </button>
    </div>
  );
}

const DIAS_LABEL = ["Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado", "Domingo"];
const HORAS_OPC: string[] = (() => {
  const out: string[] = [];
  for (let h = 6; h <= 21; h++) for (const m of ["00", "30"]) out.push(`${String(h).padStart(2, "0")}:${m}`);
  return out;
})();
type DiaState = { enabled: boolean; inicio: string; fin: string };

function DisponibilidadTab() {
  const [dias, setDias] = useState<DiaState[]>(() =>
    Array.from({ length: 7 }, () => ({ enabled: false, inicio: "09:00", fin: "18:00" })));
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    realtorApi.getDisponibilidad().then((fr) => {
      setDias((prev) => {
        const next = prev.map((d) => ({ ...d, enabled: false }));
        for (const f of fr) {
          if (f.dia_semana >= 0 && f.dia_semana < 7)
            next[f.dia_semana] = { enabled: true, inicio: f.hora_inicio, fin: f.hora_fin };
        }
        return next;
      });
    }).catch(() => {}).finally(() => setLoading(false));
  }, []);

  const set = (i: number, patch: Partial<DiaState>) =>
    setDias((prev) => prev.map((d, j) => (j === i ? { ...d, ...patch } : d)));

  const guardar = async () => {
    for (let i = 0; i < 7; i++) {
      if (dias[i].enabled && dias[i].fin <= dias[i].inicio) {
        toast.error(`${DIAS_LABEL[i]}: la hora de fin debe ser mayor a la de inicio`);
        return;
      }
    }
    const franjas: Franja[] = dias
      .map((d, i) => ({ dia_semana: i, hora_inicio: d.inicio, hora_fin: d.fin, _on: d.enabled }))
      .filter((x) => x._on)
      .map(({ _on, ...f }) => f);
    setSaving(true);
    try {
      await realtorApi.putDisponibilidad(franjas);
      toast.success("Horario guardado");
    } catch {
      toast.error("No se pudo guardar el horario");
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <Skeleton className="h-64 w-full" />;

  return (
    <div className="mx-auto max-w-lg space-y-4">
      <div>
        <h2 className="text-lg font-semibold text-foreground">Mi horario de visitas</h2>
        <p className="text-sm text-muted-foreground">
          Los interesados solo podrán agendar visitas en estas horas. Se restan automáticamente las visitas ya reservadas.
        </p>
      </div>
      <div className="divide-y divide-border rounded-xl border border-border">
        {DIAS_LABEL.map((lbl, i) => (
          <div key={i} className="flex items-center gap-3 px-4 py-3">
            <label className="flex w-32 items-center gap-2">
              <input type="checkbox" checked={dias[i].enabled} onChange={(e) => set(i, { enabled: e.target.checked })} />
              <span className="text-sm font-medium text-foreground">{lbl}</span>
            </label>
            {dias[i].enabled ? (
              <div className="flex items-center gap-2 text-sm">
                <select value={dias[i].inicio} onChange={(e) => set(i, { inicio: e.target.value })}
                  className="rounded border border-border bg-surface px-2 py-1 text-foreground">
                  {HORAS_OPC.map((h) => <option key={h} value={h}>{h}</option>)}
                </select>
                <span className="text-muted-foreground">a</span>
                <select value={dias[i].fin} onChange={(e) => set(i, { fin: e.target.value })}
                  className="rounded border border-border bg-surface px-2 py-1 text-foreground">
                  {HORAS_OPC.map((h) => <option key={h} value={h}>{h}</option>)}
                </select>
              </div>
            ) : (
              <span className="text-sm text-muted-foreground">Cerrado</span>
            )}
          </div>
        ))}
      </div>
      <button onClick={guardar} disabled={saving}
        className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground transition hover:opacity-90 disabled:opacity-60">
        {saving ? "Guardando…" : "Guardar horario"}
      </button>
    </div>
  );
}

// ── Zonas: comprar patrocinio (self-serve) ────────────────────────────────────
type ZonasDisp = {
  comunas: { cd_comuna: number; nombre: string }[];
  barrios: { id: number; nombre: string; cd_comuna: number }[];
  ocupadas: { comuna: string[]; barrio: string[] };
  precios: { comuna: number; barrio: number };
};

function ZonasCompraTab() {
  const qc = useQueryClient();
  const { data: perfil } = useRealtorPerfil();
  const [nivel, setNivel] = useState<"comuna" | "barrio">("comuna");
  const [comunaFiltro, setComunaFiltro] = useState("");
  const [comunaSel, setComunaSel] = useState("");
  const [barrioSel, setBarrioSel] = useState("");
  const [meses, setMeses] = useState(1);
  const [confirmando, setConfirmando] = useState(false);

  const disp = useQuery<ZonasDisp>({
    queryKey: ["zonas", "disponibles"],
    queryFn: () => apiFetch<ZonasDisp>(API_ENDPOINTS.zonasDisponibles),
  });

  const comprar = useMutation({
    mutationFn: async (body: { zona_nivel: string; zona_codigo: string; meses: number }) => {
      // Pasarela existente
      const r = await apiFetch<{ checkout_url?: string; modo?: string }>(API_ENDPOINTS.zonasCheckout, { method: "POST", body: JSON.stringify(body) });
      if (r.checkout_url) { window.location.href = r.checkout_url; return; }
      await apiFetch(API_ENDPOINTS.zonasConfirmarSimulado, { method: "POST", body: JSON.stringify(body) });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["realtor", "perfil"] });
      qc.invalidateQueries({ queryKey: ["zonas", "disponibles"] });
      setComunaSel(""); setBarrioSel(""); setConfirmando(false);
      toast.success("¡Zona adquirida! Ya patrocinas esa zona.");
    },
    onError: (e) => {
      setConfirmando(false);
      toast.error(/409/.test(String((e as Error).message)) ? "Esa zona ya tiene patrocinador" : "No se pudo completar la compra");
    },
  });

  const ocupComuna = new Set(disp.data?.ocupadas.comuna ?? []);
  const ocupBarrio = new Set(disp.data?.ocupadas.barrio ?? []);
  const barriosDeComuna = (disp.data?.barrios ?? []).filter((b) => String(b.cd_comuna) === comunaFiltro);
  const precioMes = nivel === "comuna" ? (disp.data?.precios.comuna ?? 0) : (disp.data?.precios.barrio ?? 0);
  const zonaCodigo = nivel === "comuna" ? comunaSel : barrioSel;
  const puede = !!zonaCodigo;
  const zonaNombre = nivel === "comuna"
    ? disp.data?.comunas.find((c) => String(c.cd_comuna) === comunaSel)?.nombre
    : disp.data?.barrios.find((b) => String(b.id) === barrioSel)?.nombre;
  const total = precioMes * meses;
  const onConfirmar = () => comprar.mutate({ zona_nivel: nivel, zona_codigo: zonaCodigo, meses });

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <section>
        <h2 className="text-lg font-semibold text-foreground">Mis zonas patrocinadas</h2>
        <p className="mb-3 text-sm text-muted-foreground">Los listings de estas zonas te llegan como leads. Solo tú las patrocinas.</p>
        {(perfil?.zonas_patrocinadas?.length ?? 0) === 0 ? (
          <p className="text-sm text-muted-foreground">Aún no patrocinas ninguna zona. Compra una abajo.</p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {perfil!.zonas_patrocinadas.map((z) => (
              <span key={z.codigo} className="inline-flex items-center gap-1.5 rounded-full border border-border bg-surface px-3 py-1 text-sm text-foreground">
                <MapPinned className={`h-3.5 w-3.5 ${z.nivel === "comuna" ? "text-primary" : "text-warning"}`} />
                {z.nombre} <span className="text-xs text-muted-foreground">({z.nivel})</span>
              </span>
            ))}
          </div>
        )}
      </section>

      <section className="rounded-xl border border-border bg-surface p-4">
        <h2 className="mb-3 text-lg font-semibold text-foreground">Comprar nueva zona</h2>

        <div className="mb-4 inline-flex rounded-lg border border-border p-0.5">
          {(["comuna", "barrio"] as const).map((n) => (
            <button
              key={n}
              onClick={() => { setNivel(n); setComunaSel(""); setBarrioSel(""); }}
              className={`rounded-md px-3 py-1.5 text-sm font-medium transition ${
                nivel === n ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {n === "comuna" ? "Comuna" : "Barrio"}
              <span className="ml-1.5 text-xs opacity-80">
                {formatCOP(n === "comuna" ? (disp.data?.precios.comuna ?? 0) : (disp.data?.precios.barrio ?? 0))}/mes
              </span>
            </button>
          ))}
        </div>

        {nivel === "barrio" && (
          <label className="mb-3 block text-sm">
            <span className="mb-1 block text-xs text-muted-foreground">Filtrar por comuna</span>
            <select
              value={comunaFiltro}
              onChange={(e) => { setComunaFiltro(e.target.value); setBarrioSel(""); }}
              className="rounded-md border border-border bg-background px-2 py-1.5 text-sm text-foreground"
            >
              <option value="">Elegir comuna…</option>
              {(disp.data?.comunas ?? []).map((c) => (
                <option key={c.cd_comuna} value={String(c.cd_comuna)}>{c.nombre}</option>
              ))}
            </select>
          </label>
        )}

        <div className="grid max-h-72 grid-cols-2 gap-2 overflow-y-auto sm:grid-cols-3">
          {nivel === "comuna"
            ? (disp.data?.comunas ?? []).map((c) => {
                const codigo = String(c.cd_comuna);
                const ocupada = ocupComuna.has(codigo);
                const selected = comunaSel === codigo;
                return (
                  <ZonaCard key={codigo} nombre={c.nombre} ocupada={ocupada} selected={selected}
                    onClick={() => setComunaSel(codigo)} />
                );
              })
            : barriosDeComuna.map((b) => {
                const codigo = String(b.id);
                const ocupada = ocupBarrio.has(codigo);
                const selected = barrioSel === codigo;
                return (
                  <ZonaCard key={codigo} nombre={b.nombre} ocupada={ocupada} selected={selected}
                    onClick={() => setBarrioSel(codigo)} />
                );
              })}
          {nivel === "barrio" && !comunaFiltro && (
            <p className="col-span-full text-sm text-muted-foreground">Elige una comuna arriba para ver sus barrios.</p>
          )}
        </div>

        <div className="mt-4 flex flex-wrap items-end justify-between gap-3">
          <label className="text-sm">
            <span className="mb-1 block text-xs text-muted-foreground">Meses</span>
            <select value={meses} onChange={(e) => setMeses(Number(e.target.value))}
              className="rounded-md border border-border bg-background px-2 py-1.5 text-sm text-foreground">
              {[1, 3, 6, 12].map((m) => <option key={m} value={m}>{m}</option>)}
            </select>
          </label>
          <div className="text-sm text-muted-foreground">
            Total: <span className="text-base font-bold text-foreground">{formatCOP(total)}</span>
            <span className="text-xs"> ({formatCOP(precioMes)}/mes × {meses})</span>
          </div>
          <button onClick={() => setConfirmando(true)} disabled={!puede}
            className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground transition hover:opacity-90 disabled:opacity-50">
            <Plus className="h-4 w-4" /> Comprar zona
          </button>
        </div>
        <p className="mt-2 text-[11px] text-muted-foreground">Una zona = un solo patrocinador (exclusiva). Pago mensual recurrente. (Pasarela en conexión — modo demo por ahora.)</p>
      </section>

      {confirmando && zonaNombre && (
        <ConfirmarCompraModal
          zonaNombre={zonaNombre}
          nivel={nivel}
          meses={meses}
          total={total}
          loading={comprar.isPending}
          onCancel={() => setConfirmando(false)}
          onConfirm={onConfirmar}
        />
      )}
    </div>
  );
}

function ZonaCard({ nombre, ocupada, selected, onClick }: { nombre: string; ocupada: boolean; selected: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      disabled={ocupada}
      className={`rounded-lg border p-3 text-left text-sm transition ${
        ocupada
          ? "cursor-not-allowed border-border bg-background opacity-50"
          : selected
            ? "border-primary bg-primary/10 font-semibold text-foreground"
            : "border-border bg-background text-foreground hover:border-primary/50"
      }`}
    >
      <div className="truncate">{nombre}</div>
      <div className={`mt-0.5 text-[11px] ${ocupada ? "text-muted-foreground" : selected ? "text-primary" : "text-success"}`}>
        {ocupada ? "Ocupada" : selected ? "Seleccionada" : "Disponible"}
      </div>
    </button>
  );
}

function ConfirmarCompraModal({
  zonaNombre, nivel, meses, total, loading, onCancel, onConfirm,
}: {
  zonaNombre: string; nivel: "comuna" | "barrio"; meses: number; total: number;
  loading: boolean; onCancel: () => void; onConfirm: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={onCancel} role="dialog" aria-modal="true" aria-label="Confirmar compra de zona">
      <div className="absolute inset-0 bg-black/40" />
      <div
        className="paper-theme relative w-full max-w-sm rounded-lg border border-border bg-background p-5 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="text-base font-semibold text-foreground">Confirmar patrocinio</h3>
        <div className="mt-3 space-y-2 rounded-lg border border-border bg-surface p-3 text-sm">
          <div className="flex justify-between"><span className="text-muted-foreground">Zona</span><span className="font-medium text-foreground">{zonaNombre}</span></div>
          <div className="flex justify-between"><span className="text-muted-foreground">Nivel</span><span className="font-medium text-foreground">{nivel === "comuna" ? "Comuna" : "Barrio"}</span></div>
          <div className="flex justify-between"><span className="text-muted-foreground">Duración</span><span className="font-medium text-foreground">{meses} {meses === 1 ? "mes" : "meses"}</span></div>
          <div className="flex justify-between border-t border-border pt-2"><span className="text-muted-foreground">Total</span><span className="font-bold text-foreground">{formatCOP(total)}</span></div>
        </div>
        <p className="mt-3 text-xs text-muted-foreground">Zona exclusiva: al confirmar, ningún otro agente podrá patrocinarla mientras esté activa.</p>
        <div className="mt-4 flex justify-end gap-2">
          <button onClick={onCancel} disabled={loading}
            className="rounded-lg border border-border px-4 py-2 text-sm font-medium text-foreground transition hover:bg-surface disabled:opacity-50">
            Cancelar
          </button>
          <button onClick={onConfirm} disabled={loading}
            className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground transition hover:opacity-90 disabled:opacity-60">
            {loading ? "Procesando…" : "Confirmar compra"}
          </button>
        </div>
      </div>
    </div>
  );
}
