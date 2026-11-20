import { seo } from "@/lib/seo";
import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useRegister, useResendVerification } from "@/hooks/useAuth";
import { AuthShell, Field, ErrorBanner, AuthButton, inputStyle } from "./login";
import { GoogleSignInButton } from "@/components/GoogleSignInButton";
import { ConsentFields } from "@/components/ConsentFields";
import { useT } from "@/lib/i18n";

export const Route = createFileRoute("/register")({
  head: () => seo({ title: "Crear cuenta · Medellín Social", description: "Crea tu cuenta gratis en Medellín Social.", path: "/register" }),
  component: RegisterPage,
});

const MLS_PATHS = ["/map", "/listing", "/vender", "/planes"];

function getOrigenFromReferrer(): "mls" | "comunidad" {
  try {
    const stored = localStorage.getItem("registro_origen");
    if (stored === "mls" || stored === "comunidad") return stored;
    // Fallback: check document.referrer pathname for hard-navigations
    const ref = new URL(document.referrer || location.href).pathname;
    return MLS_PATHS.some((p) => ref.includes(p)) ? "mls" : "comunidad";
  } catch {
    return "comunidad";
  }
}

function RegisterPage() {
  const t = useT();
  const navigate = useNavigate();
  const register = useRegister();
  const resend = useResendVerification();
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [telefono, setTelefono] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [origen, setOrigen] = useState<"mls" | "comunidad">("comunidad");
  const [habeasData, setHabeasData] = useState(false);
  const [consentWhatsapp, setConsentWhatsapp] = useState(false);

  useEffect(() => {
    setOrigen(getOrigenFromReferrer());
  }, []);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name || !email || !telefono || !password) {
      setError("Completa todos los campos.");
      return;
    }
    if (!habeasData) {
      setError("Debes aceptar la política de tratamiento de datos.");
      return;
    }
    setError("");
    try {
      await register.mutateAsync({ email, password, nombre: name, telefono, origen, habeas_data: habeasData, consent_whatsapp: consentWhatsapp });
      // No session yet: the account only works after the emailed link is confirmed.
      localStorage.removeItem("registro_origen");
      localStorage.removeItem("onboarding_complete");
      localStorage.setItem("onboarding_origen", origen);
      setSentTo(email);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error al crear la cuenta.");
    }
  };

  if (sentTo) {
    return (
      <AuthShell
        title={t("Revisa tu correo", "Check your email")}
        subtitle={t(`Te enviamos un enlace de confirmación a ${sentTo}`, `We sent a confirmation link to ${sentTo}`)}
        editorial={t("Únete a la comunidad que\nestá construyendo Medellín.", "Join the community that's\nbuilding Medellín.")}
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 16, fontFamily: "'Inter', system-ui, sans-serif", fontSize: 14, color: "#5B5F5C" }}>
          <p style={{ margin: 0 }}>
            {t("Confirma tu correo para activar tu cuenta y luego inicia sesión. Si no llega en unos minutos, revisa spam o pide otro enlace.", "Confirm your email to activate your account, then sign in. If it doesn't arrive in a few minutes, check spam or request another link.")}
          </p>
          <button
            type="button"
            disabled={resend.isPending}
            onClick={() => resend.mutate({ email: sentTo })}
            style={{ background: "none", border: "none", color: "#0F8A4F", fontWeight: 700, cursor: "pointer", padding: 0, textAlign: "left" }}
          >
            {resend.isSuccess ? "Enlace reenviado" : "Reenviar enlace"}
          </button>
          <Link to="/login" style={{ color: "#0F8A4F", fontWeight: 700, textDecoration: "none" }}>
            {t("Ir a iniciar sesión", "Go to sign in")}
          </Link>
        </div>
      </AuthShell>
    );
  }

  return (
    <AuthShell
      title="Crea tu cuenta"
      subtitle="Explora el mercado inmobiliario y la comunidad del Valle de Aburrá"
      editorial={"Únete a la comunidad que\nestá construyendo Medellín."}
    >
      <form onSubmit={submit} style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        <Field label="Nombre">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="auth-input"
            style={inputStyle}
            placeholder="Nombre completo"
          />
        </Field>
        <Field label="Correo">
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="auth-input"
            style={inputStyle}
            placeholder="tu@correo.com"
          />
        </Field>
        <Field label="Teléfono">
          <input
            type="tel"
            value={telefono}
            onChange={(e) => setTelefono(e.target.value)}
            className="auth-input"
            style={inputStyle}
            placeholder="300 123 4567"
          />
        </Field>
        <Field label="Contraseña">
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="auth-input"
            style={inputStyle}
            placeholder="Mínimo 8 caracteres"
          />
        </Field>
        <ConsentFields
          habeasData={habeasData}
          setHabeasData={setHabeasData}
          consentWhatsapp={consentWhatsapp}
          setConsentWhatsapp={setConsentWhatsapp}
        />
        {error && <ErrorBanner message={error} />}
        <AuthButton disabled={register.isPending || !habeasData}>
          {register.isPending ? "Creando cuenta…" : "Crear cuenta →"}
        </AuthButton>
        <GoogleSignInButton
          enforceConsent
          habeasData={habeasData}
          consentWhatsapp={consentWhatsapp}
          onSuccess={() => {
            localStorage.removeItem("registro_origen");
            localStorage.removeItem("onboarding_complete");
            localStorage.setItem("onboarding_origen", origen);
            window.dispatchEvent(new CustomEvent("show-onboarding", { detail: { origen } }));
            navigate({ to: origen === "mls" ? "/map" : "/" });
          }}
          onError={setError}
        />
        <div style={{ display: "flex", alignItems: "center", gap: 10, margin: "4px 0" }}>
          <span style={{ flex: 1, height: 1, background: "#E5E0D5" }} />
          <span style={{ fontSize: 12, fontFamily: "'Inter', system-ui, sans-serif", color: "#5B5F5C" }}>{t("¿Ya tienes cuenta?", "Already have an account?")}</span>
          <span style={{ flex: 1, height: 1, background: "#E5E0D5" }} />
        </div>
        <Link
          to="/login"
          style={{
            display: "flex", alignItems: "center", justifyContent: "center",
            width: "100%", padding: "13px", borderRadius: 999,
            border: "1.5px solid #0F8A4F", background: "transparent",
            color: "#0A5C36", fontFamily: "'Inter', system-ui, sans-serif",
            fontSize: 14, fontWeight: 800, textDecoration: "none",
          }}
        >
          {t("Iniciar sesión", "Sign in")}
        </Link>
      </form>
    </AuthShell>
  );
}
