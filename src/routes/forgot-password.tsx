import { seo } from "@/lib/seo";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { motion } from "framer-motion";
import { apiFetch } from "@/lib/apiClient";
import { API_ENDPOINTS } from "@/config/api";
import { AuthShell } from "./login";

export const Route = createFileRoute("/forgot-password")({
  head: () => seo({ title: "Recuperar contraseña · Medellín Social", description: "Recupera el acceso a tu cuenta.", noindex: true }),
  component: ForgotPasswordPage,
});

function ForgotPasswordPage() {
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
        <div className="space-y-4">
          <div className="rounded-lg border border-primary/40 bg-primary/10 p-4">
            <p className="text-sm text-foreground">
              Si <span className="font-semibold">{email}</span> está registrado, recibirás un correo con un enlace para
              restablecer tu contraseña. Válido por 1 hora.
            </p>
          </div>
          <Link
            to="/login"
            className="block w-full rounded-md bg-primary py-2.5 text-center text-sm font-semibold text-primary-foreground glow-cyan"
          >
            Volver al login
          </Link>
        </div>
      </AuthShell>
    );
  }

  return (
    <AuthShell title="¿Olvidaste tu contraseña?" subtitle="Te enviaremos instrucciones para recuperarla">
      <form onSubmit={submit} className="space-y-4">
        <div>
          <label className="block text-[11px] font-medium uppercase tracking-widest text-muted-foreground">
            Correo registrado
          </label>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="mt-1 w-full rounded-md border border-border bg-background/40 px-3 py-2.5 text-sm outline-none focus:border-primary focus:ring-1 focus:ring-primary"
            placeholder="tu@correo.com"
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
          {loading ? "Enviando…" : "Enviar instrucciones"}
        </motion.button>
        <p className="text-center text-xs text-muted-foreground">
          <Link to="/login" className="text-primary hover:underline">
            Volver al login
          </Link>
        </p>
      </form>
    </AuthShell>
  );
}
