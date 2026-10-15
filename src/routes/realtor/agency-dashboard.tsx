import { seo } from "@/lib/seo";
import { createFileRoute, Link, redirect } from "@tanstack/react-router";
import { RouteError, RoutePending } from "@/components/RouteStates";
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Users, Inbox, Building2, UserPlus } from "@/lib/icons";
import { apiFetch } from "@/lib/apiClient";
import { API_BASE_URL } from "@/config/api";
import { Skeleton } from "@/components/ui/skeleton";
import { formatCOP } from "@/lib/format";
import { toast } from "sonner";

export const Route = createFileRoute("/realtor/agency-dashboard")({
  errorComponent: RouteError,
  pendingComponent: RoutePending,
  beforeLoad: () => {
    if (typeof window === "undefined") return;
    const raw = localStorage.getItem("medellin-social.user");
    if (!raw) throw redirect({ to: "/login" });
  },
  component: AgencyDashboardPage,
  head: () => seo({ title: "Panel de agencia · Medellín Social", description: "Gestiona los agentes de tu agencia.", noindex: true }),
});

// ── Types ──────────────────────────────────────────────────────────────────────

type AgenteMiembro = {
  id: string;
  nombre: string;
  email: string;
  telefono: string | null;
  foto_url: string | null;
  estado: string;
  rol: string;
  listings_count: number;
  visitas_pendientes: number;
  visitas_confirmadas: number;
};

type AgencyMe = {
  agency_id: string;
  agency_nombre: string;
  agency_tipo: string;
  agent_id: string;
  agentes: AgenteMiembro[];
};

type VisitaAgencia = {
  id: string;
  listing_url: string;
  listing_titulo: string;
  nombre: string;
  telefono: string | null;
  mensaje: string | null;
  fecha_visita: string | null;
  estado: string;
  created_at: string;
  agent_id: string | null;
  agent_nombre: string | null;
  horas_pendiente: number | null;
};

type InboxData = { visitas: VisitaAgencia[] };

type AgencyListing = {
  id: string;
  titulo: string;
  estado: string;
  tipo_inmueble: string;
  operacion: string;
  precio: number;
  barrio: string;
  municipio: string;
  updated_at: string;
  agent_id: string | null;
  agent_nombre: string | null;
};

// ── Hooks ──────────────────────────────────────────────────────────────────────

function useAgencyMe() {
  return useQuery<AgencyMe>({
    queryKey: ["agency", "me"],
    queryFn: () => apiFetch<AgencyMe>(`${API_BASE_URL}/agency/me`),
    retry: 1,
  });
}

function useAgencyInbox() {
  return useQuery<InboxData>({
    queryKey: ["agency", "inbox"],
    queryFn: () => apiFetch<InboxData>(`${API_BASE_URL}/agency/inbox`),
  });
}

function useAgencyListings() {
  return useQuery<AgencyListing[]>({
    queryKey: ["agency", "listings"],
    queryFn: () => apiFetch<AgencyListing[]>(`${API_BASE_URL}/agency/listings`),
  });
}

function useDelegar() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ visitaId, agentId }: { visitaId: string; agentId: string }) =>
      apiFetch(`${API_BASE_URL}/agency/inbox/${visitaId}/delegar`, {
        method: "POST",
        body: JSON.stringify({ agent_id: agentId }),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["agency", "inbox"] });
      toast.success("Visita delegada");
    },
    onError: () => toast.error("No se pudo delegar la visita"),
  });
}

function useInvitar() {
  return useMutation({
    mutationFn: (email: string) =>
      apiFetch<{ ok: boolean; invite_url: string }>(`${API_BASE_URL}/agency/agentes/invitar`, {
        method: "POST",
        body: JSON.stringify({ email }),
      }),
    onSuccess: (data) => {
      toast.success(`Invitación enviada. Link: ${data.invite_url}`);
    },
    onError: () => toast.error("No se pudo enviar la invitación"),
  });
}

function useAsignarListing() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ listingId, agentId }: { listingId: string; agentId: string }) =>
      apiFetch(`${API_BASE_URL}/agency/listings/${listingId}/asignar`, {
        method: "PATCH",
        body: JSON.stringify({ agent_id: agentId }),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["agency", "listings"] });
      qc.invalidateQueries({ queryKey: ["agency", "me"] });
      toast.success("Listing asignado");
    },
    onError: () => toast.error("No se pudo asignar el listing"),
  });
}

// ── Page ───────────────────────────────────────────────────────────────────────

type Tab = "inbox" | "agentes" | "listings";

const TABS: { id: Tab; label: string }[] = [
  { id: "inbox",    label: "Inbox" },
  { id: "agentes",  label: "Agentes" },
  { id: "listings", label: "Listings" },
];

function AgencyDashboardPage() {
  const [tab, setTab] = useState<Tab>("inbox");
  const { data, isLoading, isError, error } = useAgencyMe();

  const noEsOwner = isError && /no es owner/i.test(String((error as Error)?.message ?? ""));

  if (!isLoading && noEsOwner) {
    return (
      <div className="paper-theme grid min-h-screen place-items-center bg-background px-4">
        <div className="max-w-sm text-center">
          <h1 className="text-lg font-semibold text-foreground">Sin acceso</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Este dashboard es para owners de agencias. Si eres agente miembro, usa el dashboard individual.
          </p>
          <Link
            to="/realtor/dashboard"
            className="mt-4 inline-flex items-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground transition hover:opacity-90"
          >
            Dashboard individual
          </Link>
        </div>
      </div>
    );
  }

  const { data: inboxData } = useAgencyInbox();
  const sinAsignar = inboxData?.visitas.filter((v) => !v.agent_id && v.estado === "pendiente").length ?? 0;

  return (
    <div className="paper-theme min-h-screen bg-background">
      {/* Nav */}
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
            <div className="flex items-center gap-2 min-w-0">
              <Building2 className="h-4 w-4 shrink-0 text-primary" />
              {isLoading ? (
                <Skeleton className="h-4 w-32" />
              ) : (
                <span className="truncate text-sm font-semibold text-foreground">
                  {data?.agency_nombre ?? "Agencia"}
                </span>
              )}
            </div>
          </div>
          <Link
            to="/realtor/dashboard"
            className="text-xs text-muted-foreground hover:text-foreground transition"
          >
            Mi dashboard individual →
          </Link>
        </div>

        <nav className="mx-auto max-w-6xl overflow-x-auto px-4 sm:px-6">
          <div className="flex gap-6">
            {TABS.map(({ id, label }) => (
              <button
                key={id}
                onClick={() => setTab(id)}
                aria-current={tab === id ? "page" : undefined}
                className={`relative shrink-0 border-b-2 pb-2.5 pt-1 text-sm transition ${
                  tab === id
                    ? "border-primary font-semibold text-foreground"
                    : "border-transparent font-medium text-muted-foreground hover:text-foreground"
                }`}
              >
                {label}
                {id === "inbox" && sinAsignar > 0 && (
                  <span className="ml-1.5 rounded-full bg-primary px-1.5 py-0.5 text-[10px] font-semibold text-primary-foreground">
                    {sinAsignar}
                  </span>
                )}
              </button>
            ))}
          </div>
        </nav>
      </header>

      <main className="mx-auto max-w-6xl px-4 pb-20 pt-8 sm:px-6">
        {tab === "inbox"    && <InboxTab agentes={data?.agentes ?? []} />}
        {tab === "agentes"  && <AgentesTab />}
        {tab === "listings" && <ListingsTab agentes={data?.agentes ?? []} />}
      </main>
    </div>
  );
}

// ══ Inbox ══════════════════════════════════════════════════════════════════════

function InboxTab({ agentes }: { agentes: AgenteMiembro[] }) {
  const { data, isLoading, isError } = useAgencyInbox();
  const delegar = useDelegar();
  const [delegandoId, setDelegandoId] = useState<string | null>(null);
  const [filtro, setFiltro] = useState<"todas" | "sin_asignar" | "asignadas">("todas");

  if (isLoading) return <SkeletonRows n={4} />;
  if (isError || !data) return <SectionError msg="No se pudo cargar el inbox." />;

  const visitas = data.visitas.filter((v) => {
    if (filtro === "sin_asignar") return !v.agent_id;
    if (filtro === "asignadas")   return !!v.agent_id;
    return true;
  });

  return (
    <section>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-foreground">
            Solicitudes de visita <span className="font-normal text-muted-foreground">({data.visitas.length})</span>
          </h2>
          <p className="text-xs text-muted-foreground">
            Visitas a listings de la agencia. Delega las sin asignar a un agente.
          </p>
        </div>
        <div className="flex gap-1">
          {(["todas", "sin_asignar", "asignadas"] as const).map((f) => (
            <button
              key={f}
              onClick={() => setFiltro(f)}
              className={`rounded-full border px-3 py-1 text-xs font-medium transition ${
                filtro === f
                  ? "border-primary bg-primary/10 text-foreground"
                  : "border-border bg-surface text-muted-foreground hover:text-foreground"
              }`}
            >
              {f === "todas" ? "Todas" : f === "sin_asignar" ? "Sin asignar" : "Asignadas"}
            </button>
          ))}
        </div>
      </div>

      {visitas.length === 0 ? (
        <EmptyState msg="No hay solicitudes con este filtro." />
      ) : (
        <div className="overflow-hidden rounded-lg border border-border bg-surface">
          {visitas.map((v, i) => (
            <div
              key={v.id}
              className={`flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-start sm:justify-between ${
                i > 0 ? "border-t border-border/70" : ""
              }`}
            >
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  <span className="font-medium text-foreground">{v.nombre || "Visitante"}</span>
                  <StatusDot estado={v.estado} />
                  {!v.agent_id && v.estado === "pendiente" && (
                    <span className="rounded bg-warning/20 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-warning">
                      Sin asignar
                    </span>
                  )}
                </div>
                <div className="mt-0.5 text-sm text-muted-foreground">
                  {v.listing_titulo}
                  {v.fecha_visita && (
                    <> · <span className="text-foreground">
                      {new Date(v.fecha_visita).toLocaleString("es-CO", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" })}
                    </span></>
                  )}
                </div>
                <div className="mt-0.5 text-xs text-muted-foreground">
                  {v.telefono || "Sin teléfono"}
                  {v.agent_id && (
                    <> · Asignado a <span className="font-medium text-foreground">{v.agent_nombre}</span></>
                  )}
                  {v.horas_pendiente != null && v.horas_pendiente >= 24 && (
                    <span className="ml-2 text-danger">⏰ {v.horas_pendiente}h sin respuesta</span>
                  )}
                </div>
              </div>

              {/* Delegar */}
              {delegandoId === v.id ? (
                <div className="flex shrink-0 flex-wrap items-center gap-2">
                  <span className="text-xs text-muted-foreground">Delegar a:</span>
                  {agentes.filter((a) => a.estado === "activo").map((a) => (
                    <button
                      key={a.id}
                      onClick={() => {
                        delegar.mutate({ visitaId: v.id, agentId: a.id });
                        setDelegandoId(null);
                      }}
                      disabled={delegar.isPending}
                      className="rounded-md border border-border px-2.5 py-1 text-xs font-medium text-foreground transition hover:bg-muted/40 disabled:opacity-50"
                    >
                      {a.nombre}
                    </button>
                  ))}
                  <button
                    onClick={() => setDelegandoId(null)}
                    className="text-xs text-muted-foreground hover:text-foreground"
                  >
                    Cancelar
                  </button>
                </div>
              ) : (
                (v.estado === "pendiente" || v.estado === "confirmada") && (
                  <button
                    onClick={() => setDelegandoId(v.id)}
                    className="shrink-0 rounded-md border border-border px-3 py-1.5 text-xs font-medium text-muted-foreground transition hover:text-foreground"
                  >
                    {v.agent_id ? "Redelegar" : "Delegar"}
                  </button>
                )
              )}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

// ══ Agentes ════════════════════════════════════════════════════════════════════

function AgentesTab() {
  const { data: me, isLoading } = useAgencyMe();
  const invitar = useInvitar();
  const [invitandoEmail, setInvitandoEmail] = useState("");
  const [showInviteForm, setShowInviteForm] = useState(false);

  if (isLoading) return <SkeletonRows n={3} />;

  const agentes = me?.agentes ?? [];

  const enviarInvite = () => {
    if (!invitandoEmail.trim()) return;
    invitar.mutate(invitandoEmail.trim(), {
      onSuccess: () => { setInvitandoEmail(""); setShowInviteForm(false); },
    });
  };

  return (
    <section>
      <div className="mb-4 flex items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-foreground">
            Equipo <span className="font-normal text-muted-foreground">({agentes.length})</span>
          </h2>
          <p className="text-xs text-muted-foreground">Miembros de {me?.agency_nombre}</p>
        </div>
        <button
          onClick={() => setShowInviteForm((v) => !v)}
          className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground transition hover:opacity-90"
        >
          <UserPlus className="h-3.5 w-3.5" /> Invitar agente
        </button>
      </div>

      {showInviteForm && (
        <div className="mb-4 flex items-center gap-2 rounded-lg border border-border bg-surface p-3">
          <input
            type="email"
            value={invitandoEmail}
            onChange={(e) => setInvitandoEmail(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && enviarInvite()}
            placeholder="email@agente.com"
            className="flex-1 rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground outline-none placeholder:text-muted-foreground focus:border-primary focus:ring-2 focus:ring-primary/20"
          />
          <button
            onClick={enviarInvite}
            disabled={invitar.isPending || !invitandoEmail.trim()}
            className="rounded-md bg-primary px-3 py-2 text-xs font-semibold text-primary-foreground transition hover:opacity-90 disabled:opacity-50"
          >
            {invitar.isPending ? "Enviando…" : "Enviar"}
          </button>
          <button onClick={() => setShowInviteForm(false)} className="text-xs text-muted-foreground hover:text-foreground">
            ✕
          </button>
        </div>
      )}

      {agentes.length === 0 ? (
        <EmptyState msg="No hay agentes en el equipo todavía." />
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border bg-surface">
          <table className="w-full min-w-[540px] text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs text-muted-foreground">
                <th className="px-4 py-3 font-medium">Agente</th>
                <th className="px-4 py-3 font-medium">Rol</th>
                <th className="px-4 py-3 font-medium">Estado</th>
                <th className="px-4 py-3 text-right font-medium">Listings</th>
                <th className="px-4 py-3 text-right font-medium">Visitas pend.</th>
              </tr>
            </thead>
            <tbody>
              {agentes.map((a, i) => (
                <tr key={a.id} className={`${i > 0 ? "border-t border-border/60" : ""} hover:bg-muted/20`}>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-3">
                      <div className="grid h-8 w-8 shrink-0 place-items-center overflow-hidden rounded-full border border-border bg-surface text-xs font-semibold text-foreground">
                        {a.foto_url
                          ? <img src={a.foto_url} alt={a.nombre} className="h-full w-full object-cover" />
                          : a.nombre.split(/\s+/).map((s) => s[0]).slice(0, 2).join("").toUpperCase()}
                      </div>
                      <div>
                        <div className="font-medium text-foreground">{a.nombre}</div>
                        <div className="text-xs text-muted-foreground">{a.email}</div>
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3 capitalize text-muted-foreground">{a.rol}</td>
                  <td className="px-4 py-3">
                    <span className={`inline-flex items-center gap-1.5 text-xs ${
                      a.estado === "activo" ? "text-success" : "text-warning"
                    }`}>
                      <span className={`h-1.5 w-1.5 rounded-full ${
                        a.estado === "activo" ? "bg-success" : "bg-warning"
                      }`} aria-hidden />
                      {a.estado === "activo" ? "Activo" : "Pendiente"}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums text-foreground">{a.listings_count}</td>
                  <td className="px-4 py-3 text-right tabular-nums">
                    <span className={a.visitas_pendientes > 0 ? "font-semibold text-warning" : "text-muted-foreground"}>
                      {a.visitas_pendientes}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

// ══ Listings ═══════════════════════════════════════════════════════════════════

function ListingsTab({ agentes }: { agentes: AgenteMiembro[] }) {
  const { data, isLoading, isError } = useAgencyListings();
  const asignar = useAsignarListing();
  const [asignandoId, setAsignandoId] = useState<string | null>(null);

  if (isLoading) return <SkeletonRows n={4} />;
  if (isError) return <SectionError msg="No se pudieron cargar los listings." />;

  const listings = data ?? [];

  return (
    <section>
      <div className="mb-4">
        <h2 className="text-base font-semibold text-foreground">
          Listings <span className="font-normal text-muted-foreground">({listings.length})</span>
        </h2>
        <p className="text-xs text-muted-foreground">Asigna o reasigna listings a agentes del equipo.</p>
      </div>

      {listings.length === 0 ? (
        <EmptyState msg="La agencia no tiene listings todavía." />
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border bg-surface">
          <table className="w-full min-w-[700px] text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs text-muted-foreground">
                <th className="px-4 py-3 font-medium">Listing</th>
                <th className="px-4 py-3 font-medium">Estado</th>
                <th className="px-4 py-3 text-right font-medium">Precio</th>
                <th className="px-4 py-3 font-medium">Agente</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody>
              {listings.map((l, i) => (
                <tr key={l.id} className={`${i > 0 ? "border-t border-border/60" : ""} hover:bg-muted/20`}>
                  <td className="px-4 py-3">
                    <div className="max-w-[240px] truncate font-medium text-foreground">{l.titulo || "Sin título"}</div>
                    <div className="text-xs capitalize text-muted-foreground">
                      {l.tipo_inmueble} · {l.operacion} · {l.barrio}
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <EstadoBadge estado={l.estado} />
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums font-medium text-foreground">{formatCOP(l.precio)}</td>
                  <td className="px-4 py-3">
                    {asignandoId === l.id ? (
                      <div className="flex flex-wrap items-center gap-1.5">
                        {agentes.filter((a) => a.estado === "activo").map((a) => (
                          <button
                            key={a.id}
                            onClick={() => {
                              asignar.mutate({ listingId: l.id, agentId: a.id });
                              setAsignandoId(null);
                            }}
                            disabled={asignar.isPending}
                            className="rounded border border-border px-2 py-0.5 text-xs font-medium text-foreground hover:bg-muted/40 disabled:opacity-50"
                          >
                            {a.nombre}
                          </button>
                        ))}
                        <button
                          onClick={() => setAsignandoId(null)}
                          className="text-xs text-muted-foreground hover:text-foreground"
                        >
                          ✕
                        </button>
                      </div>
                    ) : (
                      <span className={l.agent_nombre ? "text-foreground" : "text-muted-foreground"}>
                        {l.agent_nombre ?? "Sin asignar"}
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right">
                    {asignandoId !== l.id && (
                      <button
                        onClick={() => setAsignandoId(l.id)}
                        className="rounded-md border border-border px-2.5 py-1 text-xs font-medium text-muted-foreground transition hover:text-foreground"
                      >
                        {l.agent_nombre ? "Reasignar" : "Asignar"}
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

// ── Atoms ──────────────────────────────────────────────────────────────────────

const ESTADO_META: Record<string, { label: string; dot: string }> = {
  publicado:   { label: "Publicado",   dot: "bg-success" },
  en_revision: { label: "En revisión", dot: "bg-warning" },
  borrador:    { label: "Borrador",    dot: "bg-muted-foreground" },
  pausado:     { label: "Pausado",     dot: "bg-muted-foreground" },
  rechazado:   { label: "Rechazado",   dot: "bg-danger" },
  cerrado:     { label: "Cerrado",     dot: "bg-muted-foreground" },
};

function EstadoBadge({ estado }: { estado: string }) {
  const { label, dot } = ESTADO_META[estado] ?? { label: estado, dot: "bg-muted-foreground" };
  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-foreground">
      <span className={`h-1.5 w-1.5 rounded-full ${dot}`} aria-hidden />
      {label}
    </span>
  );
}

function StatusDot({ estado }: { estado: string }) {
  const map: Record<string, { dot: string; label: string }> = {
    pendiente:  { dot: "bg-warning",          label: "Pendiente" },
    confirmada: { dot: "bg-success",           label: "Confirmada" },
    realizada:  { dot: "bg-muted-foreground",  label: "Realizada" },
    cancelada:  { dot: "bg-muted-foreground",  label: "Cancelada" },
    no_asistio: { dot: "bg-danger",            label: "No asistió" },
  };
  const { dot, label } = map[estado] ?? { dot: "bg-muted-foreground", label: estado };
  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
      <span className={`h-1.5 w-1.5 rounded-full ${dot}`} aria-hidden />
      {label}
    </span>
  );
}

function EmptyState({ msg }: { msg: string }) {
  return (
    <div className="rounded-lg border border-dashed border-border px-6 py-10 text-center">
      <Users className="mx-auto h-5 w-5 text-muted-foreground/40" />
      <p className="mx-auto mt-2 max-w-sm text-sm text-muted-foreground">{msg}</p>
    </div>
  );
}

function SectionError({ msg }: { msg: string }) {
  return (
    <div className="rounded-lg border border-danger/30 bg-danger/10 px-4 py-3 text-sm text-danger">{msg}</div>
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
