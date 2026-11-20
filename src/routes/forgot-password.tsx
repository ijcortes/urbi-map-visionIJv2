import { seo } from "@/lib/seo";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { apiFetch } from "@/lib/apiClient";
import { API_ENDPOINTS } from "@/config/api";
import { AuthShell, Field, ErrorBanner, AuthButton, inputStyle } from "./login";
import { useT } from "@/lib/i18n";

export const Route = createFileRoute("/forgot-password")({
  head: () => seo({ title: "Recuperar contraseña · Medellín Social", description: "Recupera el acceso a tu cuenta.", noindex: true }),
  component: ForgotPasswordPage,
});

function ForgotPasswordPage() {
  const t = useT();
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [sent, setSent] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email) { setError("Ingresa tu correo."); return; }
    setError("");
    setLoading(true);
    try {
      await apiFetch<{ message: string }>(
        API_ENDPOINTS.forgotPassword,
        { method: "POST", body: JSON.stringify({ email }), skipAuth: true },
      );
      setSent(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error. Intenta de nuevo.");
    } finally {
      setLoading(false);
    }
  };

  if (sent) {
    return (
      <AuthShell title="Revisa tu correo" subtitle="Te enviamos instrucciones para recuperar tu contraseña">
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <div style={{ borderRadius: 10, border: "1px solid #0F8A4F", background: "#E7F4EC", padding: 16, fontSize: 14, color: "#0A5C36", fontFamily: "'Inter', system-ui, sans-serif", lineHeight: 1.6 }}>
            {t(
              `Si ${email} está registrado, recibirás un correo con un enlace para restablecer tu contraseña. Válido por 1 hora.`,
              `If ${email} is registered, you'll receive an email with a link to reset your password. Valid for 1 hour.`,
            )}
          </div>
          <Link
            to="/login"
            style={{ display: "block", width: "100%", background: "#0F8A4F", color: "#fff", padding: "13px", borderRadius: 999, textAlign: "center", fontSize: 14, fontWeight: 800, textDecoration: "none", fontFamily: "'Inter', system-ui, sans-serif" }}
          >
            {t("Volver al login", "Back to login")}
          </Link>
        </div>
      </AuthShell>
    );
  }

  return (
    <AuthShell title="¿Olvidaste tu contraseña?" subtitle="Te enviaremos instrucciones para recuperarla">
      <form onSubmit={submit} style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        <Field label="Correo registrado">
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
        <AuthButton disabled={loading}>
          {loading ? "Enviando…" : "Enviar instrucciones"}
        </AuthButton>
        <p style={{ textAlign: "center", fontSize: 13, fontFamily: "'Inter', system-ui, sans-serif", color: "#5B5F5C", margin: 0 }}>
          <Link to="/login" style={{ color: "#0F8A4F", fontWeight: 700, textDecoration: "none" }}>
            Volver al login
          </Link>
        </p>
      </form>
    </AuthShell>
  );
}
