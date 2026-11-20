import { seo } from "@/lib/seo";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { z } from "zod";
import { apiFetch } from "@/lib/apiClient";
import { API_ENDPOINTS } from "@/config/api";
import { AuthShell, Field, ErrorBanner, AuthButton, inputStyle } from "./login";

const searchSchema = z.object({
  token: z.string().optional(),
});

export const Route = createFileRoute("/reset-password")({
  head: () => seo({ title: "Nueva contraseña · Medellín Social", description: "Elige una nueva contraseña.", noindex: true }),
  validateSearch: searchSchema,
  component: ResetPasswordPage,
});

function ResetPasswordPage() {
  const navigate = useNavigate();
  const { token: tokenFromUrl } = Route.useSearch();

  const [token, setToken] = useState(tokenFromUrl ?? "");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!token) { setError("Ingresa el token de recuperación."); return; }
    if (password.length < 8) { setError("La contraseña debe tener mínimo 8 caracteres."); return; }
    if (password !== confirm) { setError("Las contraseñas no coinciden."); return; }
    setError("");
    setLoading(true);
    try {
      await apiFetch(API_ENDPOINTS.resetPassword, {
        method: "POST",
        body: JSON.stringify({ token, new_password: password }),
        skipAuth: true,
      });
      setDone(true);
      setTimeout(() => navigate({ to: "/login" }), 2500);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error. Token inválido o expirado.");
    } finally {
      setLoading(false);
    }
  };

  if (done) {
    return (
      <AuthShell title="¡Contraseña actualizada!" subtitle="Redirigiendo al login…">
        <div style={{ borderRadius: 10, border: "1px solid #0F8A4F", background: "#E7F4EC", padding: 16, textAlign: "center", fontSize: 14, color: "#0A5C36", fontFamily: "'Inter', system-ui, sans-serif" }}>
          Contraseña actualizada correctamente. Serás redirigido en segundos.
        </div>
      </AuthShell>
    );
  }

  return (
    <AuthShell title="Nueva contraseña" subtitle="Ingresa el token y tu nueva contraseña">
      <form onSubmit={submit} style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        <Field label="Token de recuperación">
          <input
            type="text"
            value={token}
            onChange={(e) => setToken(e.target.value)}
            className="auth-input"
            style={{ ...inputStyle, fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace", fontSize: 12 }}
            placeholder="Pega el token aquí"
          />
        </Field>
        <Field label="Nueva contraseña">
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="auth-input"
            style={inputStyle}
            placeholder="Mínimo 8 caracteres"
          />
        </Field>
        <Field label="Confirmar contraseña">
          <input
            type="password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            className="auth-input"
            style={inputStyle}
            placeholder="Repite la contraseña"
          />
        </Field>
        {error && <ErrorBanner message={error} />}
        <AuthButton disabled={loading}>
          {loading ? "Actualizando…" : "Actualizar contraseña"}
        </AuthButton>
        <p style={{ textAlign: "center", fontSize: 13, fontFamily: "'Inter', system-ui, sans-serif", color: "#5B5F5C", margin: 0 }}>
          <Link to="/forgot-password" style={{ color: "#0F8A4F", fontWeight: 700, textDecoration: "none" }}>
            Solicitar nuevo token
          </Link>
        </p>
      </form>
    </AuthShell>
  );
}
