import { seo } from "@/lib/seo";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { toast } from "sonner";
import { auth, type Budget, type Goal, type Risk, type UserType } from "@/lib/auth";
import { apiFetch } from "@/lib/apiClient";
import { API_ENDPOINTS } from "@/config/api";
import {
  Building2, Home, KeyRound, Briefcase, Shield, ShieldHalf, Flame,
  Globe2, TrendingUp,
} from "@/lib/icons";
import { LanguageToggle } from "@/lib/i18n";
import { Wordmark } from "@/components/Wordmark";

const GOAL_TO_OBJETIVO: Record<Goal, string> = {
  airbnb: "score_corto",
  "renta-larga": "score_largo",
  valorizacion: "score_largo",
  mediano_plazo: "score_mediano",
};

const BUDGET_USD: Record<Budget, string> = {
  "<200": "~$48k USD",
  "200-500": "~$48k–120k USD",
  "500-1000": "~$120k–244k USD",
  ">1000": "~$244k+ USD",
};

// Step 0 = user-type gate (no progress bar)
// Steps 1–6 = investor-only flow
const INVESTOR_STEPS = 6;

export const Route = createFileRoute("/onboarding")({
  head: () => seo({ title: "Bienvenido · Medellín Social", description: "Configura tu perfil de inversión.", noindex: true }),
  component: OnboardingPage,
});

function OnboardingPage() {
  const navigate = useNavigate();

  const [step, setStep] = useState(0);
  const [userType, setUserType] = useState<UserType | null>(null);

  // Investor steps
  const [budget, setBudget] = useState<Budget | null>(null);
  const [goal, setGoal] = useState<Goal | null>(null);
  const [questionA, setQuestionA] = useState<string | null>(null);
  const [questionB, setQuestionB] = useState<string | null>(null);
  const [risk, setRisk] = useState<Risk | null>(null);
  const [primeraPropiedad, setPrimeraPropiedad] = useState<boolean | null>(null);
  const [wantsAgent, setWantsAgent] = useState<boolean | null>(null);

  const handleUserType = (type: UserType) => {
    setUserType(type);
    if (type === "explorer") {
      auth.patch({ userType: "explorer" });
      window.location.href = '/eventos/el-poblado';
    } else {
      setStep(1);
    }
  };

  const canNext = (): boolean => {
    switch (step) {
      case 1: return !!budget;
      case 2: return !!goal;
      case 3: return !!questionA;
      case 4: return !!questionB;
      case 5: return !!risk;
      case 6: return primeraPropiedad !== null && wantsAgent !== null;
      default: return false;
    }
  };

  const next = async () => {
    if (step < INVESTOR_STEPS) {
      // Reset conditional answers whenever the objective step is left
      if (step === 2) { setQuestionA(null); setQuestionB(null); }
      setStep((s) => s + 1);
      return;
    }
    // Final submit
    if (!budget || !goal || !risk || primeraPropiedad === null || wantsAgent === null) return;

    auth.patch({
      userType: userType ?? "investor",
      budget,
      goal,
      risk,
      nUnidades:         goal === "airbnb"        ? (questionA ?? undefined) : undefined,
      tipoGestion:       goal === "airbnb"        ? (questionB ?? undefined) : undefined,
      targetInquilino:   goal === "mediano_plazo" ? (questionA ?? undefined) : undefined,
      amoblado:          goal === "mediano_plazo" ? (questionB ?? undefined) : undefined,
      tipoPago:          goal === "renta-larga"   ? (questionA ?? undefined) : undefined,
      horizonteInversion:goal === "renta-larga"   ? (questionB ?? undefined) : undefined,
      primeraPropiedad,
      wantsAgent,
    });

    apiFetch(API_ENDPOINTS.onboarding, {
      method: "POST",
      body: JSON.stringify({
        presupuesto: budget,
        objetivo: GOAL_TO_OBJETIVO[goal],
        perfil_riesgo: risk,
        tipo_usuario: userType ?? "investor",
        n_unidades:          goal === "airbnb"        ? questionA : null,
        tipo_gestion:        goal === "airbnb"        ? questionB : null,
        target_inquilino:    goal === "mediano_plazo" ? questionA : null,
        amoblado:            goal === "mediano_plazo" ? questionB : null,
        tipo_pago:           goal === "renta-larga"   ? questionA : null,
        horizonte_inversion: goal === "renta-larga"   ? questionB : null,
        primera_propiedad: primeraPropiedad,
        wants_agent: wantsAgent,
      }),
    }).catch(() => {
      toast.error("No pudimos guardar tu perfil en el servidor. Puedes continuar normalmente.");
    });

    navigate({ to: "/map" });
  };

  return (
    <div className="relative min-h-screen overflow-hidden bg-background px-4 py-10">
      <div
        className="pointer-events-none absolute inset-0 opacity-[0.06]"
        style={{
          backgroundImage:
            "linear-gradient(rgba(124,58,237,.6) 1px, transparent 1px), linear-gradient(90deg, rgba(0,212,255,.6) 1px, transparent 1px)",
          backgroundSize: "56px 56px",
        }}
      />
      <div className="pointer-events-none absolute -left-40 top-40 h-96 w-96 rounded-full bg-primary/15 blur-3xl" />
      <div className="pointer-events-none absolute -right-40 bottom-20 h-96 w-96 rounded-full bg-accent/20 blur-3xl" />

      <div className="relative z-10 mx-auto flex max-w-3xl flex-col">
        {/* Lang toggle */}
        <div className="mb-6 flex justify-end">
          <LanguageToggle />
        </div>

        {/* Logo */}
        <div className="mb-8 flex items-center gap-2">
          <div className="grid h-8 w-8 place-items-center rounded-md bg-primary/15 text-primary">
            <Building2 className="h-4 w-4" />
          </div>
          <span className="font-display text-lg font-black tracking-tight"><Wordmark /></span>
        </div>

        {/* Progress bar — only for investor steps 1–6 */}
        {step > 0 && (
          <div className="mb-8 flex items-center gap-2">
            {Array.from({ length: INVESTOR_STEPS }).map((_, i) => (
              <div key={i} className="h-1 flex-1 rounded-full bg-border">
                <motion.div
                  className="h-full rounded-full bg-primary"
                  initial={false}
                  animate={{ width: step - 1 >= i ? "100%" : "0%" }}
                  transition={{ duration: 0.3 }}
                />
              </div>
            ))}
          </div>
        )}

        <AnimatePresence mode="wait">
          <motion.div
            key={step}
            initial={{ opacity: 0, x: 24 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -24 }}
            transition={{ duration: 0.25 }}
          >
            {/* ── STEP 0: User type gate ── */}
            {step === 0 && (
              <Step
                title="¿Qué te trae a Medellín Social?"
                subtitle="Personalizaremos tu experiencia según tu objetivo."
              >
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <motion.button
                    whileHover={{ y: -2 }}
                    whileTap={{ scale: 0.98 }}
                    onClick={() => handleUserType("investor")}
                    className="flex flex-col items-center gap-4 rounded-xl border border-border bg-surface/60 p-6 text-center transition hover:border-primary/50"
                  >
                    <div className="grid h-14 w-14 place-items-center rounded-xl bg-primary/15 text-primary">
                      <TrendingUp className="h-7 w-7" />
                    </div>
                    <div>
                      <div className="text-lg font-semibold">💼 INVERSOR</div>
                      <div className="mt-1 text-sm text-muted-foreground">
                        Quiero invertir en bienes raíces en el Valle de Aburrá
                      </div>
                    </div>
                  </motion.button>

                  <motion.button
                    whileHover={{ y: -2 }}
                    whileTap={{ scale: 0.98 }}
                    onClick={() => handleUserType("explorer")}
                    className="flex flex-col items-center gap-4 rounded-xl border border-border bg-surface/60 p-6 text-center transition hover:border-primary/50"
                  >
                    <div className="grid h-14 w-14 place-items-center rounded-xl bg-accent/15 text-accent">
                      <Globe2 className="h-7 w-7" />
                    </div>
                    <div>
                      <div className="text-lg font-semibold">🌎 EXPLORADOR</div>
                      <div className="mt-1 text-sm text-muted-foreground">
                        Quiero descubrir Medellín como un local
                      </div>
                    </div>
                  </motion.button>
                </div>
              </Step>
            )}

            {/* ── STEP 1: Budget ── */}
            {step === 1 && (
              <Step
                title="¿Cuál es tu presupuesto de inversión?"
                subtitle="Lo usaremos para filtrar oportunidades en el mapa."
              >
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  {(
                    [
                      { v: "<200",    label: "< $200M COP",          hint: "Entrada al mercado" },
                      { v: "200-500", label: "$200M – $500M COP",    hint: "Apartamento típico" },
                      { v: "500-1000",label: "$500M – $1.000M COP",  hint: "Premium / 2 unidades" },
                      { v: ">1000",   label: "> $1.000M COP",        hint: "Portafolio diversificado" },
                    ] as { v: Budget; label: string; hint: string }[]
                  ).map((o) => (
                    <Choice
                      key={o.v}
                      active={budget === o.v}
                      onClick={() => setBudget(o.v)}
                      label={o.label}
                      hint={o.hint}
                      badge={BUDGET_USD[o.v]}
                    />
                  ))}
                </div>
              </Step>
            )}

            {/* ── STEP 2: Objective ── */}
            {step === 2 && (
              <Step
                title="¿Cuál es tu objetivo principal?"
                subtitle="Personalizamos la analítica según tu estrategia."
              >
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  {(
                    [
                      { v: "airbnb",       label: "Renta Corta",  hint: "Airbnb y renta corta, alta rotación",                                             Icon: KeyRound },
                      { v: "mediano_plazo",label: "Renta media",  hint: "1–6 meses: ejecutivos, nómadas digitales y profesionales en movilidad.",           Icon: Briefcase },
                      { v: "renta-larga",  label: "Renta larga",  hint: "Ingreso mensual estable",                                                          Icon: Home },
                    ] as { v: Goal; label: string; hint: string; Icon: typeof Home }[]
                  ).map((o) => (
                    <Choice
                      key={o.v}
                      active={goal === o.v}
                      onClick={() => { setGoal(o.v); setQuestionA(null); setQuestionB(null); }}
                      label={o.label}
                      hint={o.hint}
                      icon={<o.Icon className="h-5 w-5" />}
                    />
                  ))}
                </div>
              </Step>
            )}

            {/* ── STEP 3: Conditional Question A ── */}
            {step === 3 && goal === "airbnb" && (
              <Step
                title="¿Cuántas unidades estás planeando?"
                subtitle="Ajustamos las recomendaciones según el tamaño de tu portafolio."
              >
                <div className="grid grid-cols-1 gap-3">
                  {(
                    [
                      { v: "1 unidad — personal",              hint: "Empieza pequeño, aprende el mercado" },
                      { v: "2-5 unidades — portafolio pequeño", hint: "Escala con complejidad manejable" },
                      { v: "5+ unidades — portafolio completo", hint: "Estrategia de operador y objetivos de yield" },
                    ]
                  ).map((o) => (
                    <Choice key={o.v} active={questionA === o.v} onClick={() => setQuestionA(o.v)} label={o.v} hint={o.hint} />
                  ))}
                </div>
              </Step>
            )}
            {step === 3 && goal === "mediano_plazo" && (
              <Step
                title="¿Quién es tu inquilino objetivo?"
                subtitle="Destacaremos los barrios con mayor demanda para tu perfil."
              >
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  {(
                    [
                      { v: "Nómadas digitales y trabajadores remotos", hint: "Alta demanda en El Poblado, Laureles" },
                      { v: "Ejecutivos y profesionales locales",        hint: "Demanda estable, estadías más largas" },
                      { v: "Estudiantes",                               hint: "Arriendo menor, alta ocupación" },
                      { v: "Flexible — cualquier perfil",               hint: "Mayor cobertura de mercado" },
                    ]
                  ).map((o) => (
                    <Choice key={o.v} active={questionA === o.v} onClick={() => setQuestionA(o.v)} label={o.v} hint={o.hint} />
                  ))}
                </div>
              </Step>
            )}
            {step === 3 && (goal === "renta-larga" || goal === "valorizacion") && (
              <Step
                title="¿Cómo planeas pagar?"
                subtitle="Esto define qué barrios y estructuras de negocio priorizamos."
              >
                <div className="grid grid-cols-1 gap-3">
                  {(
                    [
                      { v: "Contado — pago total",               hint: "Máximo poder de negociación, cierre más rápido" },
                      { v: "Crédito hipotecario / financiamiento",hint: "Apalancamiento para propiedades de mayor valor" },
                      { v: "Aún no lo sé",                       hint: "Te mostraremos todas las opciones disponibles" },
                    ]
                  ).map((o) => (
                    <Choice key={o.v} active={questionA === o.v} onClick={() => setQuestionA(o.v)} label={o.v} hint={o.hint} />
                  ))}
                </div>
              </Step>
            )}

            {/* ── STEP 4: Conditional Question B ── */}
            {step === 4 && goal === "airbnb" && (
              <Step
                title="¿Cómo planeas administrarlo?"
                subtitle="El estilo de gestión impacta directamente tu yield neto."
              >
                <div className="grid grid-cols-1 gap-3">
                  {(
                    [
                      { v: "Autogestión",            hint: "Mayor yield, más involucramiento directo" },
                      { v: "Contratar administrador", hint: "Ingreso pasivo, menor yield neto (~15–20% comisión)" },
                      { v: "Aún no lo sé",            hint: "Te explicamos los pros y contras" },
                    ]
                  ).map((o) => (
                    <Choice key={o.v} active={questionB === o.v} onClick={() => setQuestionB(o.v)} label={o.v} hint={o.hint} />
                  ))}
                </div>
              </Step>
            )}
            {step === 4 && goal === "mediano_plazo" && (
              <Step
                title="¿Amoblado o sin amoblar?"
                subtitle="El mobiliario afecta el precio, tiempo de arriendo y tipo de inquilino."
              >
                <div className="grid grid-cols-1 gap-3">
                  {(
                    [
                      { v: "Completamente amoblado (arriendo mayor)", hint: "Hasta 30% de prima, atrae nómadas y ejecutivos" },
                      { v: "Sin amoblar (más fácil de arrendar)",      hint: "Menor barrera, inquilinos estables a largo plazo" },
                      { v: "Flexible",                                  hint: "Decide propiedad por propiedad" },
                    ]
                  ).map((o) => (
                    <Choice key={o.v} active={questionB === o.v} onClick={() => setQuestionB(o.v)} label={o.v} hint={o.hint} />
                  ))}
                </div>
              </Step>
            )}
            {step === 4 && (goal === "renta-larga" || goal === "valorizacion") && (
              <Step
                title="¿Cuál es tu horizonte de inversión?"
                subtitle="Tu horizonte define el perfil riesgo/retorno que optimizamos."
              >
                <div className="grid grid-cols-1 gap-3">
                  {(
                    [
                      { v: "5 años",                    hint: "Enfoque en barrios de mayor valorización" },
                      { v: "10 años",                   hint: "Balance entre yield y valorización a largo plazo" },
                      { v: "20+ años — largo plazo",    hint: "Prioriza estabilidad y activos defensivos" },
                    ]
                  ).map((o) => (
                    <Choice key={o.v} active={questionB === o.v} onClick={() => setQuestionB(o.v)} label={o.v} hint={o.hint} />
                  ))}
                </div>
              </Step>
            )}

            {/* ── STEP 5: Risk profile ── */}
            {step === 5 && (
              <Step
                title="¿Cuál es tu perfil de riesgo?"
                subtitle="Determina qué barrios destacaremos primero."
              >
                <div className="grid grid-cols-1 gap-3">
                  {(
                    [
                      { v: "conservador", label: "Conservador", hint: "Zonas consolidadas con yields estables (El Poblado, Laureles).", Icon: Shield },
                      { v: "moderado",    label: "Moderado",    hint: "Balance entre yield y precio (Estadio, Belén).",               Icon: ShieldHalf },
                      { v: "agresivo",    label: "Agresivo",    hint: "Mayor yield potencial en zonas emergentes (El Rodeo, Robledo).", Icon: Flame },
                    ] as { v: Risk; label: string; hint: string; Icon: typeof Shield }[]
                  ).map((o) => (
                    <Choice
                      key={o.v}
                      active={risk === o.v}
                      onClick={() => setRisk(o.v)}
                      label={o.label}
                      hint={o.hint}
                      icon={<o.Icon className="h-5 w-5" />}
                    />
                  ))}
                </div>
              </Step>
            )}

            {/* ── STEP 6: Experience + Agent ── */}
            {step === 6 && (
              <div className="space-y-10">
                <Step
                  title="¿Es tu primera propiedad en Colombia?"
                  subtitle="Personalizaremos las guías y recursos que te compartimos."
                >
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <Choice
                      active={primeraPropiedad === true}
                      onClick={() => setPrimeraPropiedad(true)}
                      label="Sí — soy nuevo en el mercado inmobiliario colombiano"
                      hint="Te asignamos un agente especializado en guiar inversores extranjeros en el proceso de compra colombiano."
                    />
                    <Choice
                      active={primeraPropiedad === false}
                      onClick={() => setPrimeraPropiedad(false)}
                      label="No — ya he invertido aquí antes"
                      hint="Proceso estándar, sin orientación adicional necesaria."
                    />
                  </div>
                </Step>

                <Step
                  title="¿Te gustaría ser contactado por un agente certificado?"
                  subtitle="Un experto local puede ayudarte a navegar el proceso de principio a fin."
                >
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <Choice
                      active={wantsAgent === true}
                      onClick={() => setWantsAgent(true)}
                      label="Sí, conéctame con un agente"
                      hint="Un agente certificado te contactará en 24 horas."
                    />
                    <Choice
                      active={wantsAgent === false}
                      onClick={() => setWantsAgent(false)}
                      label="No, exploraré por mi cuenta primero"
                      hint="Siempre puedes solicitar un agente desde tu perfil."
                    />
                  </div>
                </Step>
              </div>
            )}
          </motion.div>
        </AnimatePresence>

        {/* Navigation — only for investor steps */}
        {step > 0 && (
          <div className="mt-8 flex items-center justify-between">
            <button
              onClick={() => setStep((s) => Math.max(1, s - 1))}
              disabled={step === 1}
              className="rounded-md border border-border px-4 py-2 text-sm text-muted-foreground transition hover:text-foreground disabled:opacity-30"
            >
              Atrás
            </button>
            <button
              onClick={next}
              disabled={!canNext()}
              className="rounded-md bg-primary px-6 py-2 text-sm font-semibold text-primary-foreground transition hover:opacity-90 disabled:opacity-40 disabled:shadow-none glow-cyan"
            >
              {step === INVESTOR_STEPS ? "Ir al mapa" : "Continuar"}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function Step({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <h1 className="font-display text-3xl font-semibold tracking-tight">{title}</h1>
      <p className="mt-2 text-sm text-muted-foreground">{subtitle}</p>
      <div className="mt-6">{children}</div>
    </div>
  );
}

function Choice({
  active,
  onClick,
  label,
  hint,
  icon,
  badge,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  hint: string;
  icon?: React.ReactNode;
  badge?: string;
}) {
  return (
    <motion.button
      whileHover={{ y: -2 }}
      whileTap={{ scale: 0.98 }}
      onClick={onClick}
      className={`flex items-start gap-3 rounded-xl border p-4 text-left transition ${
        active
          ? "border-primary bg-primary/10 glow-cyan"
          : "border-border bg-surface/60 hover:border-primary/50"
      }`}
    >
      {icon && (
        <div
          className={`grid h-10 w-10 shrink-0 place-items-center rounded-lg ${
            active ? "bg-primary/20 text-primary" : "bg-background/60 text-muted-foreground"
          }`}
        >
          {icon}
        </div>
      )}
      <div className="min-w-0 flex-1">
        <div className="font-medium">{label}</div>
        {hint && <div className="mt-0.5 text-xs text-muted-foreground">{hint}</div>}
        {badge && (
          <div className="mt-1 text-xs font-medium text-primary/70">{badge}</div>
        )}
      </div>
    </motion.button>
  );
}
