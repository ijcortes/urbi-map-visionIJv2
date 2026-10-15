import { seo } from "@/lib/seo";
import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useState } from "react";
import { useLogin, useMagicLinkRequest } from "@/hooks/useAuth";
import { useLang, FlagCO, FlagUS } from "@/lib/i18n";
import { AlertCircle, Mail } from "@/lib/icons";
import { GoogleSignInButton } from "@/components/GoogleSignInButton";
import { K as TOKENS } from "@/design/tokens";

export const Route = createFileRoute("/login")({
  head: () => seo({ title: "Ingresar · Medellín Social", description: "Ingresa a tu cuenta de Medellín Social.", path: "/login" }),
  component: LoginPage,
});

const K = TOKENS;

function LoginPage() {
  const navigate = useNavigate();
  const login = useLogin();
  const magicLink = useMagicLinkRequest();
  const [mode, setMode] = useState<"password" | "magic">("password");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [magicSent, setMagicSent] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email || !password) {
      setError("Ingresa tu correo y contraseña.");
      return;
    }
    setError("");
    try {
      await login.mutateAsync({ email, password });
      navigate({ to: "/map" });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Credenciales inválidas.");
    }
  };

  const submitMagicLink = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email) {
      setError("Ingresa tu correo.");
      return;
    }
    setError("");
    try {
      await magicLink.mutateAsync({ email });
      setMagicSent(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo enviar el link.");
    }
  };

  if (mode === "magic") {
    return (
      <AuthShell
        title="Ingresa sin contraseña"
        subtitle="Te mandamos un link a tu correo — un clic y entras"
        editorial={"Tu ciudad, tus datos,\ntus decisiones."}
      >
        {magicSent ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 16, textAlign: "center" }}>
            <div style={{ display: "flex", justifyContent: "center" }}>
              <div style={{ width: 48, height: 48, borderRadius: "50%", background: "#E7F4EC", display: "flex", alignItems: "center", justifyContent: "center" }}>
                <Mail style={{ width: 22, height: 22, color: K.teal }} />
              </div>
            </div>
            <p style={{ fontFamily: K.manrope, fontSize: 14, color: K.ink, margin: 0 }}>
              Revisa <strong>{email}</strong>. El link es válido por 15 minutos y funciona una sola vez.
            </p>
            <button
              onClick={() => { setMagicSent(false); setMode("password"); }}
              style={{ background: "none", border: "none", color: K.teal, fontFamily: K.manrope, fontSize: 13, fontWeight: 600, cursor: "pointer" }}
            >
              ← Volver
            </button>
          </div>
        ) : (
          <form onSubmit={submitMagicLink} style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            <Field label="Correo">
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="auth-input"
                style={inputStyle}
                placeholder="tu@correo.com"
                autoFocus
              />
            </Field>
            {error && <ErrorBanner message={error} />}
            <AuthButton disabled={magicLink.isPending}>
              {magicLink.isPending ? "Enviando…" : "Enviarme el link"}
            </AuthButton>
            <button
              type="button"
              onClick={() => { setError(""); setMode("password"); }}
              style={{ background: "none", border: "none", color: K.muted, fontFamily: K.manrope, fontSize: 13, fontWeight: 600, cursor: "pointer" }}
            >
              ← Ingresar con contraseña
            </button>
          </form>
        )}
      </AuthShell>
    );
  }

  return (
    <AuthShell
      title="Bienvenido de nuevo"
      subtitle="Ingresa a tu cuenta para continuar"
      editorial={"Tu ciudad, tus datos,\ntus decisiones."}
    >
      <form onSubmit={submit} style={{ display: "flex", flexDirection: "column", gap: 16 }}>
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
        <Field label="Contraseña">
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="auth-input"
            style={inputStyle}
            placeholder="••••••••"
          />
        </Field>
        <div style={{ display: "flex", justifyContent: "space-between" }}>
          <button
            type="button"
            onClick={() => { setError(""); setMode("magic"); }}
            style={{ background: "none", border: "none", padding: 0, color: K.teal, fontSize: 13, fontFamily: K.manrope, fontWeight: 600, cursor: "pointer" }}
          >
            Ingresar sin contraseña
          </button>
          <Link
            to="/forgot-password"
            style={{ color: K.teal, fontSize: 13, fontFamily: K.manrope, fontWeight: 600, textDecoration: "none" }}
          >
            ¿Olvidaste tu contraseña?
          </Link>
        </div>
        {error && <ErrorBanner message={error} />}
        <AuthButton disabled={login.isPending}>
          {login.isPending ? "Entrando…" : "Iniciar sesión"}
        </AuthButton>
        <GoogleSignInButton
          onSuccess={() => {
            navigate({ to: "/map" });
          }}
          onError={setError}
        />
        <p style={{ textAlign: "center", fontSize: 13, fontFamily: K.manrope, color: K.muted, margin: 0 }}>
          ¿No tienes cuenta?{" "}
          <Link to="/register" style={{ color: K.teal, fontWeight: 700, textDecoration: "none" }}>
            Regístrate
          </Link>
        </p>
      </form>
    </AuthShell>
  );
}

export function AuthShell({
  title,
  subtitle,
  editorial,
  children,
}: {
  title: string;
  subtitle: string;
  editorial?: string;
  children: React.ReactNode;
}) {
  return (
    <>
      <style>{`
        .auth-input:focus {
          border-color: #0F8A4F !important;
          box-shadow: 0 0 0 3px rgba(29,158,117,0.12) !important;
          outline: none;
        }
        .auth-btn:hover:not(:disabled) {
          background: #0A5C36 !important;
        }
        .auth-input::placeholder {
          color: #9aada6;
          font-weight: 400;
        }
      `}</style>
      <div style={{ display: "flex", minHeight: "100dvh", background: K.paper, fontFamily: K.manrope }}>
        {/* Left editorial column — desktop only */}
        <div
          className="hidden lg:flex"
          style={{
            width: "48%",
            position: "relative",
            flexDirection: "column",
            justifyContent: "flex-end",
            padding: "56px 52px",
            overflow: "hidden",
          }}
        >
          {/* Photo */}
          <img
            src="https://images.unsplash.com/photo-1697082390861-9f5186b44431?auto=format&fit=crop&w=1200&q=80"
            alt="Medellín"
            style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover", zIndex: 0 }}
          />
          {/* Gradient overlay */}
          <div style={{ position: "absolute", inset: 0, background: "linear-gradient(to top, rgba(8,30,22,.92) 0%, rgba(8,30,22,.55) 55%, rgba(20,32,29,.2) 100%)", zIndex: 1 }} />

          {/* Content */}
          <div style={{ position: "relative", zIndex: 2, maxWidth: 400 }}>
            <div style={{ fontFamily: K.manrope, fontSize: ".62rem", fontWeight: 800, color: "rgba(255,255,255,.5)", textTransform: "uppercase", letterSpacing: "1.8px", marginBottom: 20 }}>
              Medellín Social
            </div>
            {editorial && (
              <p style={{
                fontFamily: K.serif,
                fontSize: "clamp(1.6rem, 2.8vw, 2.2rem)",
                fontWeight: 900,
                color: "#fff",
                lineHeight: 1.15,
                letterSpacing: "-0.5px",
                marginBottom: 32,
                whiteSpace: "pre-line",
              }}>
                {editorial}
              </p>
            )}
            {/* Stats pills */}
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              {["54K+ propiedades", "606 barrios", "12K+ negocios"].map(s => (
                <span key={s} style={{ fontFamily: K.manrope, fontSize: ".68rem", fontWeight: 600, color: "rgba(255,255,255,.7)", background: "rgba(255,255,255,.1)", border: "1px solid rgba(255,255,255,.16)", padding: "4px 11px", borderRadius: 999 }}>
                  {s}
                </span>
              ))}
            </div>
          </div>
        </div>

        {/* Right form column */}
        <div
          style={{
            flex: 1,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            padding: "48px 24px",
            position: "relative",
            background: K.paper,
          }}
        >
          {/* Language toggle */}
          <div style={{ position: "absolute", top: 16, right: 16 }}>
            <AuthLangToggle />
          </div>

          {/* Mobile logo */}
          <div className="lg:hidden" style={{ marginBottom: 28, textAlign: "center" }}>
            <span style={{ fontFamily: K.serif, fontSize: "1.7rem", fontWeight: 900, color: K.ink }}>
              Medellín Social
            </span>
          </div>

          {/* Form area — no white card, form sits on paper */}
          <div style={{ width: "100%", maxWidth: 400 }}>
            <h1 style={{
              fontFamily: K.serif,
              fontSize: "clamp(1.7rem, 3.5vw, 2rem)",
              fontWeight: 900,
              color: K.ink,
              margin: "0 0 8px 0",
              lineHeight: 1.1,
              letterSpacing: "-.5px",
            }}>
              {title}
            </h1>
            <p style={{ fontFamily: K.manrope, fontSize: 14, color: K.muted, margin: "0 0 36px 0", lineHeight: 1.6 }}>
              {subtitle}
            </p>
            {children}
          </div>
        </div>
      </div>
    </>
  );
}

export const inputStyle: React.CSSProperties = {
  width: "100%",
  background: "#fff",
  border: "1px solid #E5E0D5",
  borderRadius: 10,
  padding: "13px 16px",
  color: "#111418",
  fontFamily: "'Inter', system-ui, sans-serif",
  fontSize: 14,
  fontWeight: 500,
  outline: "none",
  boxSizing: "border-box",
  transition: "border-color 0.15s, box-shadow 0.15s",
};

export function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div
        style={{
          fontFamily: "'Inter', system-ui, sans-serif",
          fontSize: 11,
          fontWeight: 700,
          color: "#5B5F5C",
          textTransform: "uppercase",
          letterSpacing: "0.09em",
          marginBottom: 7,
        }}
      >
        {label}
      </div>
      {children}
    </div>
  );
}

export function ErrorBanner({ message }: { message: string }) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        background: "#FCE8EA",
        border: "1px solid #CE1126",
        borderRadius: 8,
        padding: "10px 14px",
        fontFamily: "'Inter', system-ui, sans-serif",
        fontSize: 13,
        color: "#8B2A10",
      }}
    >
      <AlertCircle style={{ width: 14, height: 14, flexShrink: 0, color: "#CE1126" }} />
      {message}
    </div>
  );
}

function AuthLangToggle() {
  const { lang, toggle } = useLang();
  return (
    <div style={{ display: "inline-flex", gap: 6 }}>
      {(["es", "en"] as const).map(l => (
        <button
          key={l}
          onClick={lang !== l ? toggle : undefined}
          title={l === "es" ? "Español (Colombia)" : "English (USA)"}
          style={{
            borderRadius: 999,
            border: `1.5px solid ${lang === l ? K.teal : K.line}`,
            background: lang === l ? "#E7F4EC" : K.paper,
            padding: "4px 8px",
            cursor: lang === l ? "default" : "pointer",
            display: "flex", alignItems: "center",
            transition: "border-color 0.15s, background 0.15s",
          }}
        >
          {l === "es" ? <FlagCO /> : <FlagUS />}
        </button>
      ))}
    </div>
  );
}

export function AuthButton({
  children,
  disabled,
}: {
  children: React.ReactNode;
  disabled?: boolean;
}) {
  return (
    <button
      type="submit"
      disabled={disabled}
      className="auth-btn"
      style={{
        width: "100%",
        background: "#0F8A4F",
        color: "#fff",
        fontFamily: "'Inter', system-ui, sans-serif",
        fontSize: 14,
        fontWeight: 800,
        letterSpacing: ".2px",
        border: "none",
        borderRadius: 999,
        padding: "14px",
        cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? 0.65 : 1,
        transition: "background 0.15s",
        boxShadow: "0 4px 16px rgba(29,158,117,.25)",
      }}
    >
      {children}
    </button>
  );
}
