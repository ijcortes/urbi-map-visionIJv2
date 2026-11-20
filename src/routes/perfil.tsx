import { seo } from "@/lib/seo";
import { createFileRoute, Link, redirect, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { apiFetch } from "@/lib/apiClient";
import { API_ENDPOINTS } from "@/config/api";
import { ComunidadLayout } from "@/components/comunidad/ComunidadLayout";
import { motion, AnimatePresence } from "framer-motion";
import {
  ArrowLeft,
  Building2,
  Camera,
  Check,
  Heart,
  History,
  Search,
  Settings,
  Star,
  Trash2,
  TrendingUp,
  User as UserIcon,
} from "@/lib/icons";
import {
  auth,
  GOAL_LABEL,
  type Budget,
  type Goal,
  type PerfilBusqueda,
  type Risk,
  type UrbiUser,
} from "@/lib/auth";
import { useUpdateAuthPerfil, logout } from "@/hooks/useAuth";
import { useTarget } from "@/contexts/TargetContext";
import { useT } from "@/lib/i18n";
import { useFavoritos, useToggleFavorito, useHistorial } from "@/hooks/useUser";
import { useFavoritosListings, useFavoritosListingsFull } from "@/hooks/useFavoritosListings";
import { formatCOP } from "@/lib/format";

export const Route = createFileRoute("/perfil")({
  head: () => seo({ title: "Mi perfil · Medellín Social", description: "Tu cuenta en Medellín Social.", noindex: true }),
  beforeLoad: () => {
    if (typeof window === "undefined") return;
    const raw = localStorage.getItem("medellin-social.user");
    if (!raw) throw redirect({ to: "/login" });
  },
  component: PerfilRoute,
});

// Mismo navbar/footer que el home (ComunidadLayout sin compact: masthead + barra
// + ticker), no la versión slim.
function PerfilRoute() {
  return (
    <ComunidadLayout initialSlug="todos">
      <PerfilPage />
    </ComunidadLayout>
  );
}

type Tab = "cuenta" | "inmuebles" | "busqueda" | "inversor" | "favoritos" | "historial";

const TABS: { id: Tab; label: string; Icon: typeof UserIcon }[] = [
  { id: "cuenta", label: "Cuenta", Icon: UserIcon },
  { id: "inmuebles", label: "Tus inmuebles", Icon: Building2 },
  { id: "busqueda", label: "Perfil de búsqueda", Icon: Search },
  { id: "inversor", label: "Perfil inversor", Icon: TrendingUp },
  { id: "favoritos", label: "Favoritos", Icon: Heart },
  { id: "historial", label: "Historial", Icon: History },
];

function PerfilPage() {
  const [tab, setTab] = useState<Tab>(() => {
    if (typeof window === "undefined") return "cuenta";
    const t = new URLSearchParams(window.location.search).get("tab");
    return (TABS.some((x) => x.id === t) ? t : "cuenta") as Tab;
  });
  const [user, setUser] = useState<UrbiUser | null>(() => auth.get());

  useEffect(() => {
    const sync = () => setUser(auth.get());
    window.addEventListener("medellin-social:user", sync);
    return () => window.removeEventListener("medellin-social:user", sync);
  }, []);

  if (!user) return null;

  return (
    <div className="perfil-light mx-auto max-w-6xl px-4 pb-16 pt-10 sm:px-6">
        <Link
          to="/map"
          className="inline-flex items-center gap-1.5 text-[11px] uppercase tracking-widest text-muted-foreground transition hover:text-primary"
        >
          <ArrowLeft className="h-3 w-3" /> Volver al mapa
        </Link>

        <div className="mt-4 flex items-center gap-1.5 text-[#6E726E]">
          <Settings className="h-3 w-3" />
          <h1 className="text-[11px] font-bold uppercase tracking-[0.15em]">Configuración</h1>
        </div>

        <ProfileHeader user={user} />

        <div className="mt-6 grid gap-6 md:grid-cols-[240px_1fr]">
          {/* Sidebar tabs */}
          <aside className="flex flex-row gap-2 overflow-x-auto md:flex-col md:overflow-visible">
            {TABS.map((t) => {
              const active = tab === t.id;
              return (
                <button
                  key={t.id}
                  onClick={() => setTab(t.id)}
                  className={`group flex items-center gap-2 whitespace-nowrap rounded-xl border px-3 py-2 text-sm transition ${
                    active
                      ? "border-[#0F8A4F]/50 border-l-[3px] border-l-[#0F8A4F] bg-[#E7F4EC] text-[#0A5C36] font-semibold"
                      : "border-transparent bg-transparent text-[#5B5F5C] hover:bg-[#F3F0E8] hover:text-[#111418]"
                  }`}
                >
                  <t.Icon className="h-4 w-4" />
                  {t.label}
                </button>
              );
            })}
          </aside>

          {/* Content */}
          <section className="rounded-2xl p-5 sm:p-6" style={{ background: '#FFFFFF', border: '0.5px solid #E5E0D5', boxShadow: '0 1px 3px rgba(26,18,8,0.05)' }}>
            <AnimatePresence mode="wait">
              <motion.div
                key={tab}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
                transition={{ duration: 0.18 }}
              >
                {tab === "cuenta" && <CuentaTab user={user} />}
                {tab === "inmuebles" && <InmueblesTab />}
                {tab === "busqueda" && <BusquedaTab user={user} />}
                {tab === "inversor" && <InversorTab user={user} />}
                {tab === "favoritos" && <FavoritosTab user={user} />}
                {tab === "historial" && <HistorialTab user={user} />}
              </motion.div>
            </AnimatePresence>
          </section>
        </div>
    </div>
  );
}

/* ---------------- Header ---------------- */

const PLAN_LABEL: Record<string, string> = { pro: "Pro", agente: "Agente" };

// Agrupa favoritos por comuna (o municipio si la comuna no aplica, p.ej. otros
// municipios del Valle) — el "huella" es literalmente un eco comprimido del mapa,
// construido con la actividad real del usuario, no un contador genérico.
function zonaFootprint(favs: { comuna?: string | null; municipio?: string | null }[]) {
  const counts = new Map<string, number>();
  for (const f of favs) {
    const key = f.comuna || f.municipio || "Otra zona";
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1]);
}

function ProfileHeader({ user }: { user: UrbiUser }) {
  const { data: favs } = useFavoritos();
  const { data: hist } = useHistorial();
  const initials = user.name.split(/\s+/).map((s) => s[0]).slice(0, 2).join("").toUpperCase();
  const perfilInfo = user.perfilBusqueda ? BUSQUEDA_OPTIONS.find((o) => o.value === user.perfilBusqueda) : null;
  const footprint = zonaFootprint(favs ?? []);
  const maxCount = footprint[0]?.[1] ?? 1;

  return (
    <div
      className="mt-6 overflow-hidden rounded-2xl"
      style={{ background: "#FFFFFF", border: "0.5px solid #E5E0D5", boxShadow: "0 1px 3px rgba(26,18,8,0.05)" }}
    >
      <div className="flex flex-col gap-5 p-6 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-4">
          <div className="grid h-16 w-16 shrink-0 place-items-center overflow-hidden rounded-full bg-gradient-to-br from-[#0F8A4F] to-[#0A5C36] text-xl font-bold text-[#E7F4EC] ring-2 ring-[#0F8A4F]/30">
            {user.avatar ? <img src={user.avatar} alt="avatar" className="h-full w-full object-cover" /> : initials || "U"}
          </div>
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="font-display text-2xl font-semibold tracking-tight text-[#111418]">{user.name}</h2>
              {user.plan && PLAN_LABEL[user.plan] && (
                <span className="rounded-full bg-[#FFF4D6] px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-[#8A6D1D]">
                  {PLAN_LABEL[user.plan]}
                </span>
              )}
            </div>
            <div className="text-xs text-[#5B5F5C]">{user.email}</div>
            {perfilInfo && (
              <div className="mt-1 text-[11px] font-medium text-[#0F8A4F]">
                {perfilInfo.icon} {perfilInfo.title}
              </div>
            )}
          </div>
        </div>

        <div className="flex gap-6 sm:gap-8">
          <StatBlock label="Barrios guardados" value={favs?.length ?? 0} />
          <StatBlock label="Actividad reciente" value={hist?.length ?? 0} />
        </div>
      </div>

      {/* Huella en el Valle de Aburrá — un eco del mapa, no una estadística genérica */}
      <div className="border-t px-6 py-3.5" style={{ borderColor: "#F3F0E8", background: "#FDFBF7" }}>
        {footprint.length > 0 ? (
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[10px] font-bold uppercase tracking-widest text-[#6E726E]">
              Tu huella en el Valle de Aburrá
            </span>
            <div className="flex flex-wrap gap-1.5">
              {footprint.slice(0, 8).map(([zona, count]) => (
                <span
                  key={zona}
                  className="rounded-full px-2.5 py-1 text-[11px] font-semibold"
                  style={{
                    // Capped at alpha 0.5 so #0A5C36 text stays WCAG AA (4.5:1+) at every intensity.
                    background: `rgba(29,158,117,${0.12 + 0.38 * (count / maxCount)})`,
                    color: "#0A5C36",
                  }}
                >
                  {zona} · {count}
                </span>
              ))}
            </div>
          </div>
        ) : (
          <div className="flex items-center justify-between gap-3 text-[11px] text-[#6E726E]">
            <span>Aún no guardas zonas. Toca ⭐ en un barrio del mapa para empezar tu huella.</span>
            <Link to="/map" className="shrink-0 font-semibold text-[#0F8A4F] hover:underline">
              Ir al mapa →
            </Link>
          </div>
        )}
      </div>
    </div>
  );
}

function StatBlock({ label, value }: { label: string; value: number }) {
  return (
    <div className="text-center sm:text-right">
      <div className="font-display text-2xl font-bold text-[#111418]">{value}</div>
      <div className="text-[10px] uppercase tracking-widest text-[#5B5F5C]">{label}</div>
    </div>
  );
}

/* ---------------- Cuenta ---------------- */

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

function CuentaTab({ user }: { user: UrbiUser }) {
  const t = useT();
  const [name, setName] = useState(user.name);
  const [email, setEmail] = useState(user.email);
  const [avatar, setAvatar] = useState<string | undefined>(user.avatar);
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");
  const [emailNote, setEmailNote] = useState(false);
  const [reset, setReset] = useState<"idle" | "sending" | "sent">("idle");
  const fileRef = useRef<HTMLInputElement>(null);
  const navigate = useNavigate();

  const initials = name.split(/\s+/).map((s) => s[0]).slice(0, 2).join("").toUpperCase();

  const onPickFile = (file: File) => {
    if (!file.type.startsWith("image/")) return;
    const reader = new FileReader();
    reader.onload = () => setAvatar(String(reader.result));
    reader.readAsDataURL(file);
  };

  // Persiste de verdad en el backend (antes solo tocaba localStorage → "✓ Guardado"
  // mentía). El avatar sigue siendo local al dispositivo (ver nota debajo).
  const save = async () => {
    setErr("");
    const nm = name.trim();
    const em = email.trim().toLowerCase();
    if (!nm) return setErr(t("El nombre no puede estar vacío.", "Name can't be empty."));
    if (!EMAIL_RE.test(em)) return setErr(t("Correo inválido.", "Invalid email."));
    setSaving(true);
    try {
      const res = await apiFetch<{ ok: boolean; email_verificacion_enviada?: boolean }>(
        API_ENDPOINTS.authPerfil,
        { method: "PATCH", body: JSON.stringify({ nombre: nm, email: em }) },
      );
      auth.patch({ name: nm, email: em, avatar });
      setEmailNote(!!res?.email_verificacion_enviada);
      setSaved(true);
      setTimeout(() => setSaved(false), 1800);
    } catch (e) {
      setErr(e instanceof Error ? e.message : t("No se pudo guardar. Intenta de nuevo.", "Couldn't save. Please try again."));
    } finally {
      setSaving(false);
    }
  };

  // Cambio de contraseña = flujo seguro por correo (el mismo /forgot-password).
  // No hay endpoint de cambio-logueado y falsear uno inline sería otra mentira.
  const sendPasswordReset = async () => {
    setReset("sending");
    try {
      await apiFetch(API_ENDPOINTS.forgotPassword, {
        method: "POST",
        body: JSON.stringify({ email: user.email }),
        skipAuth: true,
      });
    } catch { /* forgot-password responde 200 aunque el correo no exista; da igual */ }
    setReset("sent");
  };

  return (
    <div className="space-y-6">
      <SectionTitle title="Cuenta" hint="Foto, nombre, correo y contraseña." />

      <div className="flex flex-col items-start gap-5 sm:flex-row sm:items-center">
        <div className="relative">
          <div className="grid h-24 w-24 place-items-center overflow-hidden rounded-full bg-gradient-to-br from-[#0F8A4F] to-[#0A5C36] text-2xl font-bold text-[#E7F4EC] ring-2 ring-[#0F8A4F]/40">
            {avatar ? <img src={avatar} alt="avatar" className="h-full w-full object-cover" /> : initials || "U"}
          </div>
          <button
            onClick={() => fileRef.current?.click()}
            className="absolute -bottom-1 -right-1 grid h-8 w-8 place-items-center rounded-full border border-border bg-surface text-primary transition hover:bg-primary hover:text-primary-foreground"
            title="Cambiar foto"
          >
            <Camera className="h-4 w-4" />
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => e.target.files?.[0] && onPickFile(e.target.files[0])}
          />
        </div>

        <div className="text-xs text-muted-foreground">
          PNG o JPG. La imagen se guarda solo en tu dispositivo.
          {avatar && (
            <button
              onClick={() => setAvatar(undefined)}
              className="ml-3 inline-flex items-center gap-1 text-danger hover:underline"
            >
              <Trash2 className="h-3 w-3" /> Quitar
            </button>
          )}
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Nombre">
          <input className={inputCls} value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label="Correo">
          <input className={inputCls} type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
        </Field>
      </div>

      {err && (
        <div className="rounded-md border border-[#CE1126]/40 bg-[#FCE8EA] px-3 py-2 text-xs text-[#8B2A10]">
          {err}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <button
          onClick={save}
          disabled={saving}
          className="rounded-md bg-primary px-5 py-2 text-sm font-semibold text-primary-foreground transition hover:opacity-90 glow-cyan disabled:opacity-60"
        >
          {saving ? "Guardando…" : "Guardar cambios"}
        </button>
        {saved && (
          <motion.span initial={{ opacity: 0, x: -6 }} animate={{ opacity: 1, x: 0 }} className="text-xs text-success">
            ✓ Guardado
          </motion.span>
        )}
      </div>

      {emailNote && (
        <div className="rounded-md border border-[#0F8A4F]/40 bg-[#E7F4EC] px-3 py-2 text-xs text-[#0A5C36]">
          {t(
            `Cambiaste tu correo. Te enviamos un enlace a ${email.trim().toLowerCase()} para confirmarlo. Tu sesión actual sigue activa.`,
            `You changed your email. We sent a confirmation link to ${email.trim().toLowerCase()}. Your current session stays active.`,
          )}
        </div>
      )}

      {/* Contraseña — flujo seguro por correo, no un campo que miente */}
      <div className="rounded-xl border border-[#E5E0D5] bg-[#FDFBF7] p-4">
        <div className="text-sm font-semibold text-[#111418]">{t("Contraseña", "Password")}</div>
        {reset === "sent" ? (
          <p className="mt-1 text-xs text-[#5B5F5C]">
            {t(
              `Te enviamos un enlace a ${user.email} para cambiar tu contraseña. Es válido por 1 hora.`,
              `We sent a link to ${user.email} to change your password. It's valid for 1 hour.`,
            )}
          </p>
        ) : (
          <>
            <p className="mt-1 text-xs text-[#5B5F5C]">
              {t("Por seguridad, la contraseña se cambia con un enlace que te enviamos a tu correo.", "For security, your password is changed through a link we email you.")}
            </p>
            <button
              onClick={sendPasswordReset}
              disabled={reset === "sending"}
              className="mt-3 rounded-md border border-[#0F8A4F] px-4 py-1.5 text-xs font-semibold text-[#0A5C36] transition hover:bg-[#E7F4EC] disabled:opacity-60"
            >
              {reset === "sending" ? t("Enviando…", "Sending…") : t("Enviar enlace para cambiar contraseña", "Send link to change password")}
            </button>
          </>
        )}
      </div>

      <div className="flex justify-end">
        <button
          onClick={() => {
            if (confirm("¿Cerrar sesión?")) {
              logout();
              navigate({ to: "/login" });
            }
          }}
          className="text-xs text-muted-foreground hover:text-danger"
        >
          Cerrar sesión
        </button>
      </div>
    </div>
  );
}

/* ---------------- Búsqueda ---------------- */

const BUSQUEDA_OPTIONS: { value: PerfilBusqueda; icon: string; title: string; hint: string }[] = [
  { value: "comprador", icon: "🏠", title: "Comprar o arrendar", hint: "Busco una propiedad para vivir en el Valle de Aburrá" },
  { value: "inversor", icon: "📈", title: "Invertir en finca raíz", hint: "Analizo rentabilidad, yields y oportunidades" },
  { value: "vendedor", icon: "🏡", title: "Vender mi propiedad", hint: "Quiero publicar y conectar con compradores" },
  { value: "agente", icon: "🤝", title: "Soy agente inmobiliario", hint: "Uso las herramientas profesionales del MLS" },
];

const PERFIL_TO_TARGET: Record<PerfilBusqueda, "buyer" | "investor" | "seller" | null> = {
  comprador: "buyer",
  inversor: "investor",
  vendedor: "seller",
  agente: null,
};

function BusquedaTab({ user }: { user: UrbiUser }) {
  const [selected, setSelected] = useState<PerfilBusqueda | null>(
    (user.perfilBusqueda as PerfilBusqueda) ?? null
  );
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState<"ok" | "err" | null>(null);
  const updatePerfil = useUpdateAuthPerfil();
  const { setTarget } = useTarget();

  async function save(perfil: PerfilBusqueda) {
    setSelected(perfil);
    setSaving(true);
    try {
      await updatePerfil.mutateAsync({ perfil_busqueda: perfil });
      auth.patch({ perfilBusqueda: perfil });
      const target = PERFIL_TO_TARGET[perfil];
      if (target) setTarget(target as never);
      setToast("ok");
    } catch {
      setToast("err");
    } finally {
      setSaving(false);
      setTimeout(() => setToast(null), 3000);
    }
  }

  return (
    <div className="space-y-5">
      <SectionTitle
        title="¿Qué estás buscando?"
        hint="Personalizamos el mapa y las recomendaciones según tu perfil."
      />

      <div className="space-y-2.5">
        {BUSQUEDA_OPTIONS.map((o) => {
          const active = selected === o.value;
          return (
            <button
              key={o.value}
              onClick={() => !saving && save(o.value)}
              disabled={saving}
              className="flex w-full items-start gap-3 rounded-xl border p-3.5 text-left transition disabled:opacity-60"
              style={{
                background: "#FFFFFF",
                borderColor: active ? "#0F8A4F" : "#E5E0D5",
                boxShadow: active ? "0 0 0 1px #0F8A4F" : "none",
              }}
            >
              <span className="mt-0.5 text-xl leading-none">{o.icon}</span>
              <div className="flex-1">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-semibold text-[#111418]">{o.title}</span>
                  {active && <Check className="h-4 w-4 text-[#0F8A4F]" />}
                </div>
                <p className="mt-0.5 text-xs text-[#5B5F5C]">{o.hint}</p>
              </div>
            </button>
          );
        })}
      </div>

      <div className="flex items-center gap-3 pt-1">
        {toast === "ok" && (
          <motion.span initial={{ opacity: 0, x: -6 }} animate={{ opacity: 1, x: 0 }} className="text-xs text-success">
            ✅ Perfil actualizado
          </motion.span>
        )}
        {toast === "err" && (
          <motion.span initial={{ opacity: 0, x: -6 }} animate={{ opacity: 1, x: 0 }} className="text-xs text-danger">
            ❌ Error al guardar. Intenta de nuevo.
          </motion.span>
        )}
      </div>
    </div>
  );
}

/* ---------------- Inversor ---------------- */

function InversorTab({ user }: { user: UrbiUser }) {
  const [budget, setBudget] = useState<Budget | undefined>(user.budget);
  const [goal, setGoal] = useState<Goal | undefined>(user.goal);
  const [risk, setRisk] = useState<Risk | undefined>(user.risk);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState<"ok" | "err" | null>(null);

  async function save() {
    setSaving(true);
    try {
      await apiFetch(API_ENDPOINTS.perfil, {
        method: "PUT",
        body: JSON.stringify({
          objetivo: goal ?? null,
          perfil_riesgo: risk ?? null,
          presupuesto: budget ?? null,
        }),
      });
      auth.patch({ budget, goal, risk });
      window.dispatchEvent(new CustomEvent("perfil-updated", { detail: auth.get() }));
      setDirty(false);
      setToast("ok");
    } catch {
      setToast("err");
    } finally {
      setSaving(false);
      setTimeout(() => setToast(null), 3000);
    }
  }

  return (
    <div className="space-y-6">
      <SectionTitle title="Perfil inversor" hint="Editamos tus filtros y recomendaciones del mapa." />

      <Field label="Presupuesto">
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {(["<200", "200-500", "500-1000", ">1000"] as Budget[]).map((b) => (
            <Pill key={b} active={budget === b} onClick={() => { setBudget(b); setDirty(true); }}>
              {b === "<200" ? "< $200M" : b === "200-500" ? "$200–500M" : b === "500-1000" ? "$500M–1.000M" : "> $1.000M"}
            </Pill>
          ))}
        </div>
      </Field>

      <Field label="Objetivo">
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {(Object.keys(GOAL_LABEL) as Goal[]).filter((g) => g !== "valorizacion").map((g) => (
            <Pill key={g} active={goal === g} onClick={() => { setGoal(g as Goal); setDirty(true); }}>{GOAL_LABEL[g]}</Pill>
          ))}
        </div>
      </Field>

      <Field label="Perfil de riesgo">
        <div className="grid grid-cols-3 gap-2">
          {(["conservador", "moderado", "agresivo"] as Risk[]).map((r) => (
            <Pill key={r} active={risk === r} onClick={() => { setRisk(r); setDirty(true); }}>
              <span className="capitalize">{r}</span>
            </Pill>
          ))}
        </div>
      </Field>

      <div className="flex flex-wrap items-center gap-3">
        {dirty && (
          <button
            onClick={save}
            disabled={saving}
            className="rounded-md bg-primary px-5 py-2 text-sm font-semibold text-primary-foreground transition hover:opacity-90 glow-cyan disabled:opacity-50"
          >
            {saving ? "Guardando…" : "Guardar cambios"}
          </button>
        )}
        {toast === "ok" && (
          <motion.span initial={{ opacity: 0, x: -6 }} animate={{ opacity: 1, x: 0 }} className="text-xs text-success">
            ✅ Perfil actualizado
          </motion.span>
        )}
        {toast === "err" && (
          <motion.span initial={{ opacity: 0, x: -6 }} animate={{ opacity: 1, x: 0 }} className="text-xs text-danger">
            ❌ Error al guardar. Intenta de nuevo.
          </motion.span>
        )}
      </div>
    </div>
  );
}

/* ---------------- Favoritos ---------------- */

const TIPO_LABEL: Record<string, string> = { arriendo: "Arriendo", venta: "Venta" };

/* ---------------- Tus inmuebles (propiedades publicadas por el usuario) ---------------- */

type MisListing = {
  id: string;
  tipo_operacion: string | null;
  tipo_inmueble: string | null;
  precio_cop: number | null;
  area_m2: number | null;
  habitaciones: number | null;
  estado: string | null;
  verificado: boolean | null;
  destacado: boolean | null;
  fotos: string[];
  barrio: string | null;
  municipio: string | null;
  vistas_total: number | null;
  vistas_30d: number | null;
  favoritos: number | null;
};

const ESTADO_BADGE: Record<string, { label: string; bg: string; color: string }> = {
  borrador:    { label: "Borrador",    bg: "#F3F0E8", color: "#6E726E" },
  en_revision: { label: "En revisión", bg: "#FFF4D6", color: "#8A6D1D" },
  publicado:   { label: "Publicado",   bg: "#E7F4EC", color: "#0A5C36" },
  activo:      { label: "Activo",       bg: "#E7F4EC", color: "#0A5C36" },
  pausado:     { label: "Pausado",      bg: "#F3F0E8", color: "#6E726E" },
  rechazado:   { label: "Rechazado",    bg: "#FCE8EA", color: "#8B2A10" },
};

function InmueblesTab() {
  const { data: listings = [], isLoading, isError } = useQuery<MisListing[]>({
    queryKey: ["mis-listings"],
    queryFn: () => apiFetch<MisListing[]>(API_ENDPOINTS.listingsPropiosMis),
    staleTime: 60_000,
  });

  return (
    <div className="space-y-5">
      <SectionTitle title="Tus inmuebles" hint="Las propiedades que publicaste en Medellín Social." />
      {isLoading ? (
        <div className="py-8 text-center text-sm text-muted-foreground">Cargando…</div>
      ) : isError ? (
        <div className="rounded-xl border border-danger/40 bg-danger/10 p-4 text-sm text-danger">Error al cargar. Verifica tu conexión.</div>
      ) : listings.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-[#E5E0D5] p-8 text-center">
          <div className="mx-auto mb-3 grid h-12 w-12 place-items-center rounded-full bg-[#E7F4EC] text-[#0F8A4F]"><Building2 className="h-6 w-6" /></div>
          <p className="text-sm font-semibold text-[#111418]">Aún no has publicado inmuebles</p>
          <p className="mx-auto mt-1 max-w-xs text-xs text-[#6E726E]">Publica tu propiedad gratis y aparecerá en el mapa de Medellín Social frente a miles de compradores.</p>
          <a href="/publicar" className="mt-4 inline-flex items-center gap-1.5 rounded-lg bg-[#0F8A4F] px-5 py-2.5 text-sm font-semibold text-white transition hover:opacity-90">
            Publicar una propiedad →
          </a>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          {listings.map((l) => {
            const est = l.estado ? ESTADO_BADGE[l.estado] : null;
            return (
              <div key={l.id} className="overflow-hidden rounded-2xl border border-[#E5E0D5] bg-white transition hover:-translate-y-0.5 hover:shadow-lg hover:shadow-[#111418]/5">
                <div className="relative h-36 overflow-hidden bg-[#E7F4EC]">
                  {l.fotos?.[0] ? (
                    <img src={l.fotos[0]} alt="" className="h-full w-full object-cover" loading="lazy" />
                  ) : (
                    <div className="grid h-full w-full place-items-center text-[#0F8A4F]/40"><Building2 className="h-8 w-8" /></div>
                  )}
                  {est && (
                    <span className="absolute left-2 top-2 rounded px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider" style={{ background: est.bg, color: est.color }}>
                      {est.label}
                    </span>
                  )}
                  {l.verificado && (
                    <span className="absolute right-2 top-2 rounded px-2 py-0.5 text-[10px] font-bold text-white" style={{ background: "#0A5C36" }}>✓ Verificado</span>
                  )}
                </div>
                <div className="p-3.5">
                  <div className="font-display text-lg font-bold text-[#111418]">{l.precio_cop != null ? formatCOP(l.precio_cop) : "—"}</div>
                  <div className="mt-0.5 text-[12px] text-[#5B5F5C]">
                    {[l.tipo_inmueble && titleCaseEs(l.tipo_inmueble), l.habitaciones != null && `${l.habitaciones} hab`, l.area_m2 != null && `${Math.round(l.area_m2)} m²`].filter(Boolean).join(" · ") || "—"}
                  </div>
                  {(l.barrio || l.municipio) && (
                    <div className="mt-1 truncate text-[11px] text-[#6E726E]">{[l.barrio && titleCaseEs(l.barrio), l.municipio && titleCaseEs(l.municipio)].filter(Boolean).join(", ")}</div>
                  )}
                  <div className="mt-3 flex items-center gap-4 border-t border-[#F3F0E8] pt-2.5 text-[11px] text-[#5B5F5C]">
                    <span><strong className="text-[#111418]">{l.vistas_30d ?? 0}</strong> vistas (30d)</span>
                    <span><strong className="text-[#111418]">{l.favoritos ?? 0}</strong> guardados</span>
                  </div>
                </div>
              </div>
            );
          })}
          <a href="/publicar" className="grid place-items-center rounded-2xl border border-dashed border-[#0F8A4F]/40 p-6 text-center text-sm font-semibold text-[#0F8A4F] transition hover:bg-[#E7F4EC]">
            + Publicar otra propiedad
          </a>
        </div>
      )}
    </div>
  );
}

function FavoritosTab({ user: _user }: { user: UrbiUser }) {
  const { data: inmuebles = [], isLoading: loadingInm, isError: errorInm } = useFavoritosListingsFull();
  const { toggle } = useFavoritosListings();
  const { data: barrios = [], isLoading: loadingBar } = useFavoritos();
  const { remove } = useToggleFavorito();

  return (
    <div className="space-y-8">
      {/* ── Inmuebles guardados (el corazón ❤ del mapa/drawer) ── */}
      <div className="space-y-4">
        <SectionTitle title="Inmuebles guardados" hint="Las propiedades que marcaste con ❤ en el mapa." />
        {loadingInm ? (
          <div className="py-8 text-center text-sm text-muted-foreground">Cargando inmuebles…</div>
        ) : errorInm ? (
          <div className="rounded-xl border border-danger/40 bg-danger/10 p-4 text-sm text-danger">Error al cargar. Verifica tu conexión.</div>
        ) : inmuebles.length === 0 ? (
          <div className="rounded-xl border border-dashed border-[#E5E0D5] p-8 text-center text-sm text-[#6E726E]">
            Aún no guardas inmuebles. Toca el <span className="text-[#CE1126]">❤</span> en una propiedad del mapa para guardarla aquí.
          </div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2">
            {inmuebles.map((f) => (
              <div key={f.url} className="group overflow-hidden rounded-2xl border border-[#E5E0D5] bg-white transition hover:-translate-y-0.5 hover:shadow-lg hover:shadow-[#111418]/5">
                <div className="relative h-36 overflow-hidden bg-[#E7F4EC]">
                  {f.foto ? (
                    <img src={f.foto} alt="" className="h-full w-full object-cover" loading="lazy" />
                  ) : (
                    <div className="grid h-full w-full place-items-center text-[#0F8A4F]/40"><Building2 className="h-8 w-8" /></div>
                  )}
                  {f.tipo_operacion && (
                    <span className="absolute left-2 top-2 rounded px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider"
                      style={{ background: f.tipo_operacion === "arriendo" ? "#E7F4EC" : "#FCE8EA", color: f.tipo_operacion === "arriendo" ? "#0F8A4F" : "#CE1126" }}>
                      {TIPO_LABEL[f.tipo_operacion] ?? f.tipo_operacion}
                    </span>
                  )}
                  <button
                    onClick={() => toggle(f.url)}
                    title="Quitar de guardados"
                    className="absolute right-2 top-2 grid h-9 w-9 place-items-center rounded-full bg-white/95 shadow-sm transition hover:scale-110"
                  >
                    <Heart className="h-[18px] w-[18px]" style={{ color: "#CE1126" }} fill="#CE1126" />
                  </button>
                </div>
                <div className="p-3.5">
                  <div className="font-display text-lg font-bold text-[#111418]">
                    {f.precio_cop != null ? formatCOP(f.precio_cop) : "Precio no disponible"}
                  </div>
                  <div className="mt-0.5 text-[12px] text-[#5B5F5C]">
                    {[f.habitaciones != null && `${f.habitaciones} hab`, f.banos != null && `${Math.round(f.banos)} baños`, f.area_m2 != null && `${Math.round(f.area_m2)} m²`].filter(Boolean).join(" · ") || "—"}
                  </div>
                  {(f.barrio_nombre || f.municipio) && (
                    <div className="mt-1 truncate text-[11px] text-[#6E726E]">
                      {[f.barrio_nombre && titleCaseEs(f.barrio_nombre), f.municipio && titleCaseEs(f.municipio)].filter(Boolean).join(", ")}
                    </div>
                  )}
                  <a href={`/map?listing=${f.listing_id}`}
                    className="mt-3 block rounded-lg border border-[#E5E0D5] py-2 text-center text-[11px] font-semibold text-[#0F8A4F] transition hover:bg-[#E7F4EC]">
                    Ver en el mapa →
                  </a>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ── Barrios guardados (⭐) ── */}
      {(loadingBar || barrios.length > 0) && (
        <div className="space-y-4">
          <SectionTitle title="Barrios guardados" hint="Zonas que marcaste con ⭐ con tu configuración exacta." />
          <div className="grid gap-3.5 sm:grid-cols-2">
            {barrios.map((f) => (
              <div key={f.id} className="overflow-hidden rounded-2xl border border-[#E5E0D5] bg-white transition hover:-translate-y-0.5 hover:shadow-lg hover:shadow-[#111418]/5">
                <div className="p-4">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="text-[10px] uppercase tracking-widest text-[#6E726E]">{f.municipio ?? "Barrio"}</div>
                      <div className="mt-0.5 truncate font-display text-lg font-semibold text-[#111418]">{f.nombre ?? `Barrio ${f.barrio_id}`}</div>
                      {f.comuna && <div className="text-[11px] text-[#5B5F5C]">{f.comuna}</div>}
                    </div>
                    <button onClick={() => remove.mutate(f.barrio_id)} disabled={remove.isPending} title="Quitar de favoritos"
                      className="shrink-0 text-[#CE1126] transition hover:scale-110 disabled:opacity-50">
                      <Star className="h-[18px] w-[18px] fill-current" />
                    </button>
                  </div>
                  <div className="mt-3 flex items-center justify-between rounded-lg bg-[#F3F0E8] px-3 py-2">
                    <span className="text-[11px] font-medium text-[#5B5F5C]">Yield bruto</span>
                    <span className="font-display text-sm font-bold text-[#0F8A4F]">{f.yield_bruto != null ? `${f.yield_bruto.toFixed(1)}%` : "—"}</span>
                  </div>
                </div>
                <Link to="/map" className="block border-t border-[#E5E0D5] px-4 py-2.5 text-center text-[11px] font-semibold text-[#0F8A4F] transition hover:bg-[#E7F4EC]">
                  Ver en el mapa →
                </Link>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// Barrio names come ALL CAPS ("EL CHOCHO"); sentence-case for display.
function titleCaseEs(s: string): string {
  return s.toLowerCase().replace(/(^|\s)\p{L}/gu, (c) => c.toUpperCase());
}

/* ---------------- Historial ---------------- */

const HISTORIAL_ICON: Record<string, string> = {
  simulacion: "💰",
  vista_barrio: "👁",
  comparacion: "↔️",
  favorito: "⭐",
};

function HistorialTab({ user: _user }: { user: UrbiUser }) {
  const { data: items = [], isLoading, isError } = useHistorial();

  return (
    <div className="space-y-5">
      <SectionTitle title="Historial" hint="Tus últimas simulaciones y búsquedas (últimas 20)." />
      {isLoading ? (
        <div className="py-8 text-center text-sm text-muted-foreground">Cargando historial...</div>
      ) : isError ? (
        <div className="rounded-xl border border-danger/40 bg-danger/10 p-4 text-sm text-danger">
          Error al cargar historial. Verifica tu conexión.
        </div>
      ) : items.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
          Sin actividad reciente.
        </div>
      ) : (
        <div className="space-y-2">
          {items.map((h) => {
            const label =
              h.tipo === "simulacion"
                ? `Simuló ${h.barrio_nombre ?? `barrio ${h.barrio_id}`}`
                : h.tipo === "comparacion"
                ? "Comparó barrios"
                : `Vio ${h.barrio_nombre ?? `barrio ${h.barrio_id}`}`;
            return (
              <div
                key={h.id}
                className="flex items-center justify-between rounded-xl border border-[#E5E0D5] bg-white px-3.5 py-2.5 text-sm text-[#111418] transition hover:border-[#0F8A4F]/30"
              >
                <div className="flex items-center gap-3">
                  <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-[#E7F4EC] text-sm">
                    {HISTORIAL_ICON[h.tipo] ?? "📋"}
                  </span>
                  <span className="font-medium">{label}</span>
                </div>
                <time className="shrink-0 text-[11px] text-[#6E726E]">
                  {relativeTime(new Date(h.created_at).getTime())}
                </time>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function relativeTime(ts: number): string {
  const diff = Date.now() - ts;
  const min = Math.floor(diff / 60000);
  if (min < 1) return "ahora";
  if (min < 60) return `hace ${min}m`;
  const h = Math.floor(min / 60);
  if (h < 24) return `hace ${h}h`;
  const d = Math.floor(h / 24);
  return `hace ${d}d`;
}

/* ---------------- Atoms ---------------- */

const inputCls =
  "w-full rounded-md border border-[#E5E0D5] bg-[#FAF8F3] px-3 py-2 text-sm text-[#111418] outline-none transition placeholder:text-[#5B5F5C]/60 focus:border-[#0F8A4F] focus:ring-2 focus:ring-[#E7F4EC]";

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <div className="mb-1.5 text-[11px] font-bold uppercase tracking-widest text-[#5B5F5C]">{label}</div>
      {children}
    </label>
  );
}

function Pill({ active, onClick, children }: { active?: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-md border px-3 py-2 text-xs font-medium transition ${
        active ? "border-[#0F8A4F] bg-[#E7F4EC] text-[#0A5C36] font-semibold" : "border-[#E5E0D5] bg-[#FAF8F3] text-[#5B5F5C] hover:bg-[#F3F0E8] hover:text-[#111418]"
      }`}
    >
      {children}
    </button>
  );
}

function SectionTitle({ title, hint }: { title: string; hint?: string }) {
  return (
    <div>
      <h2 className="font-display text-xl font-semibold">{title}</h2>
      {hint && <p className="mt-0.5 text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

// Use formatCOP elsewhere to satisfy any future budget displays
void formatCOP;
