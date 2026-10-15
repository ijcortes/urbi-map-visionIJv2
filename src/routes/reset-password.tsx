import { seo } from "@/lib/seo";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { motion } from "framer-motion";
import { z } from "zod";
import { apiFetch } from "@/lib/apiClient";
import { API_ENDPOINTS } from "@/config/api";
import { AuthShell } from "./login";

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
        <div className="rounded-xl border border-success/40 bg-success/10 p-4 text-center text-sm text-success">
          Contraseña actualizada correctamente. Serás redirigido en segundos.
        </div>
      </AuthShell>
    );
  }

  return (
    <AuthShell title="Nueva contraseña" subtitle="Ingresa el token y tu nueva contraseña">
      <form onSubmit={submit} className="space-y-4">
        <div>
          <label className="block text-[11px] font-medium uppercase tracking-widest text-muted-foreground">
            Token de recuperación
          </label>
          <input
            type="text"
            value={token}
            onChange={(e) => setToken(e.target.value)}
            className="mt-1 w-full rounded-md border border-border bg-background/40 px-3 py-2.5 font-mono text-xs outline-none focus:border-primary focus:ring-1 focus:ring-primary"
            placeholder="Pega el token aquí"
          />
        </div>
        <div>
          <label className="block text-[11px] font-medium uppercase tracking-widest text-muted-foreground">
            Nueva contraseña
          </label>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="mt-1 w-full rounded-md border border-border bg-background/40 px-3 py-2.5 text-sm outline-none focus:border-primary focus:ring-1 focus:ring-primary"
            placeholder="Mínimo 8 caracteres"
          />
        </div>
        <div>
          <label className="block text-[11px] font-medium uppercase tracking-widest text-muted-foreground">
            Confirmar contraseña
          </label>
          <input
            type="password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            className="mt-1 w-full rounded-md border border-border bg-background/40 px-3 py-2.5 text-sm outline-none focus:border-primary focus:ring-1 focus:ring-primary"
            placeholder="Repite la contraseña"
          />
        </div>
        {error && <p className="text-xs text-danger">{error}</p>}
        <motion.button
          whileHover={{ scale: 1.01 }}
          whileTap={{ scale: 0.99 }}
          type="submit"
          disabled={loading}
          className="w-full rounded-md bg-primary py-2.5 text-sm font-semibold text-primary-foreground glow-cyan disabled:opacity-60"
        >
          {loading ? "Actualizando…" : "Actualizar contraseña"}
        </motion.button>
        <p className="text-center text-xs text-muted-foreground">
          <Link to="/forgot-password" className="text-primary hover:underline">
            Solicitar nuevo token
          </Link>
        </p>
      </form>
    </AuthShell>
  );
}
