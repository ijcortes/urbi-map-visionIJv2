import { seo } from "@/lib/seo";
import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useRegister, useResendVerification } from "@/hooks/useAuth";
import { AuthShell, Field, ErrorBanner, AuthButton, inputStyle } from "./login";
import { GoogleSignInButton } from "@/components/GoogleSignInButton";

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

  useEffect(() => {
    setOrigen(getOrigenFromReferrer());
  }, []);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name || !email || !telefono || !password) {
      setError("Completa todos los campos.");
      return;
    }
    setError("");
    try {
      await register.mutateAsync({ email, password, nombre: name, telefono, origen });
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
        title="Revisa tu correo"
        subtitle={`Te enviamos un enlace de confirmación a ${sentTo}`}
        editorial={"Únete a la comunidad que\nestá construyendo Medellín."}
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 16, fontFamily: "'Inter', system-ui, sans-serif", fontSize: 14, color: "#5B5F5C" }}>
          <p style={{ margin: 0 }}>
            Confirma tu correo para activar tu cuenta y luego inicia sesión. Si no llega en unos minutos, revisa spam o pide otro enlace.
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
            Ir a iniciar sesión
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
        {error && <ErrorBanner message={error} />}
        <AuthButton disabled={register.isPending}>
          {register.isPending ? "Creando cuenta…" : "Crear cuenta →"}
        </AuthButton>
        <GoogleSignInButton
          onSuccess={() => {
            localStorage.removeItem("registro_origen");
            localStorage.removeItem("onboarding_complete");
            localStorage.setItem("onboarding_origen", origen);
            window.dispatchEvent(new CustomEvent("show-onboarding", { detail: { origen } }));
            navigate({ to: origen === "mls" ? "/map" : "/" });
          }}
          onError={setError}
        />
        <p style={{ textAlign: "center", fontSize: 13, fontFamily: "'Inter', system-ui, sans-serif", color: "#5B5F5C", margin: 0 }}>
          ¿Ya tienes cuenta?{" "}
          <Link to="/login" style={{ color: "#0F8A4F", fontWeight: 700, textDecoration: "none" }}>
            Inicia sesión
          </Link>
        </p>
      </form>
    </AuthShell>
  );
}
