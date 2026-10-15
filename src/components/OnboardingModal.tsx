import { useEffect, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { motion, AnimatePresence } from "framer-motion";
import { X, Check } from "@/lib/icons";
import { toast } from "sonner";
import { auth, type PerfilBusqueda } from "@/lib/auth";
import { useMe, useUpdateAuthPerfil } from "@/hooks/useAuth";
import { useTarget } from "@/contexts/TargetContext";
import { getToken } from "@/lib/apiClient";

const LS_COMPLETE = "onboarding_complete";
const LS_ORIGEN = "onboarding_origen";

export function OnboardingModal() {
  const [show, setShow] = useState(false);
  const [origen, setOrigen] = useState<"mls" | "comunidad">("mls");

  const updatePerfil = useUpdateAuthPerfil();
  const { setTarget } = useTarget();
  const navigate = useNavigate();

  // Triggered immediately after registration via window event
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<{ origen: string }>).detail;
      const orig = (detail?.origen ?? "mls") as "mls" | "comunidad";
      setOrigen(orig);
      setShow(true);
    };
    window.addEventListener("show-onboarding", handler);
    return () => window.removeEventListener("show-onboarding", handler);
  }, []);

  // Fallback: hard-refresh after registration, or localStorage cleared but DB says incomplete
  const { data: meData } = useMe();
  useEffect(() => {
    if (show) return;
    if (!getToken()) return;
    if (localStorage.getItem(LS_COMPLETE) === "true") return;
    if (!meData) return;

    const completado = meData.user.onboarding_completado ?? false;
    if (completado) {
      localStorage.setItem(LS_COMPLETE, "true");
      return;
    }
    const orig = (meData.user.origen_registro ?? auth.get()?.origenRegistro ?? "mls") as "mls" | "comunidad";
    setOrigen(orig);
    setShow(true);
  }, [meData, show]);

  const dismiss = async () => {
    setShow(false);
    localStorage.setItem(LS_COMPLETE, "true");
    localStorage.removeItem(LS_ORIGEN);
    try {
      await updatePerfil.mutateAsync({ onboarding_completado: true });
    } catch {
      // non-critical
    }
  };

  if (!show) return null;

  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4 pointer-events-none">
        <motion.div
          initial={{ opacity: 0, scale: 0.95, y: 16 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.95, y: 16 }}
          transition={{ duration: 0.25 }}
          className="pointer-events-auto relative w-full rounded-2xl shadow-2xl"
          style={{
            background: "#FAF8F3",
            border: "1px solid #E5E0D5",
            maxWidth: "min(480px, 92vw)",
          }}
        >
          <button
            onClick={dismiss}
            aria-label="Cerrar"
            className="absolute right-3 top-3 grid h-8 w-8 place-items-center rounded-full text-[#5B5F5C] transition hover:bg-[#E5E0D5] hover:text-[#111418]"
          >
            <X className="h-4 w-4" />
          </button>

          <div className="p-6 pb-5">
            {/* Logo */}
            <div className="mb-4 flex items-center gap-2">
              <div className="grid h-7 w-7 place-items-center rounded-md bg-[#0F8A4F]/15 text-[#0F8A4F]">
                <span className="text-sm font-bold">M</span>
              </div>
              <span className="text-sm font-semibold text-[#111418]">Medellín Social</span>
            </div>

            {origen === "mls" ? (
              <MLSContent
                onSelect={async (perfil) => {
                  setShow(false);
                  localStorage.setItem(LS_COMPLETE, "true");
                  localStorage.removeItem(LS_ORIGEN);
                  try {
                    await updatePerfil.mutateAsync({
                      perfil_busqueda: perfil,
                      onboarding_completado: true,
                    });
                    auth.patch({ perfilBusqueda: perfil as PerfilBusqueda, onboardingCompletado: true });
                  } catch {
                    // non-critical
                  }
                  if (perfil === "comprador") {
                    setTarget("buyer");
                    toast.success("Perfil guardado. Explorando el mapa…");
                  } else if (perfil === "inversor") {
                    setTarget("investor");
                    toast.success("Perfil guardado. Explorando el mapa…");
                  } else if (perfil === "vendedor") {
                    navigate({ to: "/vender" });
                  } else if (perfil === "agente") {
                    navigate({ to: "/planes", search: { audiencia: "agente" } });
                  }
                }}
                onClose={dismiss}
              />
            ) : (
              <ComunidadContent onClose={dismiss} />
            )}
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  );
}

// ── MLS variant ───────────────────────────────────────────────────────────────

type MLSPerfil = "comprador" | "inversor" | "vendedor" | "agente";

const MLS_OPTIONS: { value: MLSPerfil; icon: string; title: string; hint: string }[] = [
  { value: "comprador", icon: "🏠", title: "Comprar o arrendar", hint: "Encuentra tu próxima propiedad para vivir en el Valle de Aburrá" },
  { value: "inversor", icon: "📈", title: "Invertir en finca raíz", hint: "Analiza rentabilidad, yields y oportunidades de inversión" },
  { value: "vendedor", icon: "🏡", title: "Vender mi propiedad", hint: "Publica y conecta con compradores e inversores" },
  { value: "agente", icon: "🤝", title: "Soy agente inmobiliario", hint: "Herramientas profesionales para cerrar más ventas" },
];

function MLSContent({
  onSelect,
  onClose,
}: {
  onSelect: (p: MLSPerfil) => void;
  onClose: () => void;
}) {
  const [selected, setSelected] = useState<MLSPerfil | null>(null);

  return (
    <>
      <h2 className="font-display text-[28px] font-semibold leading-tight text-[#111418]">
        ¡Bienvenido a Medellín Social!
      </h2>
      <p className="mt-1.5 text-[15px] text-[#5B5F5C]">
        Cuéntanos qué estás buscando para mostrarte lo más relevante
      </p>

      <div className="mt-5 space-y-2.5">
        {MLS_OPTIONS.map((o) => {
          const active = selected === o.value;
          return (
            <button
              key={o.value}
              onClick={() => setSelected(o.value)}
              className="flex w-full items-start gap-3 rounded-xl border p-3.5 text-left transition"
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

      <button
        disabled={!selected}
        onClick={() => selected && onSelect(selected)}
        className="mt-5 w-full rounded-xl py-2.5 text-sm font-semibold text-white transition disabled:opacity-40"
        style={{ background: selected ? "#0F8A4F" : "#A8C5BB" }}
      >
        Continuar →
      </button>

      <div className="my-4 flex items-center gap-3">
        <div className="h-px flex-1 bg-[#E5E0D5]" />
        <span className="text-[11px] text-[#5B5F5C]">También en Medellín Social</span>
        <div className="h-px flex-1 bg-[#E5E0D5]" />
      </div>

      <div className="rounded-xl p-3.5" style={{ background: "#F3F0E8", border: "1px solid #E5E0D5" }}>
        <p className="text-xs text-[#5B5F5C]">
          Descubre eventos, negocios y la cultura del Valle de Aburrá en nuestra comunidad
        </p>
        <button onClick={onClose} className="mt-2 text-xs font-semibold text-[#0F8A4F] hover:underline">
          Ver comunidad →
        </button>
      </div>
    </>
  );
}

// ── Comunidad variant ─────────────────────────────────────────────────────────

function ComunidadContent({ onClose }: { onClose: () => void }) {
  const navigate = useNavigate();

  const CHECKS = [
    "Subir fotos y contenido de eventos",
    "Descubrir negocios y tiendas locales",
    "Conectar con tu comunidad",
  ];

  return (
    <>
      <h2 className="font-display text-[28px] font-semibold leading-tight text-[#111418]">
        ¡Ya eres parte de Medellín Social!
      </h2>
      <p className="mt-1.5 text-[15px] text-[#5B5F5C]">
        Explora tu ciudad, conecta con tu barrio y descubre lo mejor del Valle de Aburrá
      </p>

      <div className="mt-5 space-y-2.5">
        {CHECKS.map((item) => (
          <div key={item} className="flex items-center gap-2.5">
            <span className="grid h-5 w-5 shrink-0 place-items-center rounded-full bg-[#0F8A4F]/15 text-[#0F8A4F]">
              <Check className="h-3 w-3" />
            </span>
            <span className="text-sm text-[#111418]">{item}</span>
          </div>
        ))}
      </div>

      <button
        onClick={onClose}
        className="mt-5 w-full rounded-xl py-2.5 text-sm font-semibold text-white transition hover:opacity-90"
        style={{ background: "#0F8A4F" }}
      >
        Explorar la comunidad →
      </button>

      <div className="my-4 flex items-center gap-3">
        <div className="h-px flex-1 bg-[#E5E0D5]" />
        <div className="h-px flex-1 bg-[#E5E0D5]" />
      </div>

      <div className="rounded-xl p-3.5" style={{ background: "#E7F4EC", border: "1px solid #0F8A4F" }}>
        <div className="flex items-start gap-2">
          <span className="text-base">🏠</span>
          <div>
            <p className="text-xs font-semibold text-[#0A5C36]">¿Buscas tu próxima propiedad?</p>
            <p className="mt-0.5 text-xs text-[#0F8A4F]">
              Tenemos 54,000+ inmuebles en venta y arriendo en el Valle de Aburrá
            </p>
            <button
              onClick={() => { onClose(); navigate({ to: "/map" }); }}
              className="mt-2 rounded-md border border-[#0F8A4F] px-3 py-1.5 text-[11px] font-semibold text-[#0A5C36] transition hover:bg-[#0F8A4F] hover:text-white"
            >
              Ver inmuebles en el mapa →
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
