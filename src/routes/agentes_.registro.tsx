import { seo } from "@/lib/seo";
import { createFileRoute, Link, redirect } from "@tanstack/react-router";
import { useState } from "react";
import { motion } from "framer-motion";
import { apiFetch } from "@/lib/apiClient";
import { API_ENDPOINTS } from "@/config/api";
import { AuthShell } from "./login";

export const Route = createFileRoute("/agentes_/registro")({
  head: () => seo({ title: "Registro de agentes · Medellín Social", description: "Regístrate como agente inmobiliario en Medellín Social.", path: "/agentes/registro" }),
  beforeLoad: () => {
    if (typeof window === "undefined") return;
    if (!localStorage.getItem("medellin-social.user")) {
      throw redirect({ to: "/login", search: { redirect: "/agentes/registro" } as never });
    }
  },
  component: AgenteRegistroPage,
});

type AgenteRegistroOut = { id: string; estado: "pendiente" | "activo" | "rechazado" };

function AgenteRegistroPage() {
  const [nombre, setNombre] = useState("");
  const [telefono, setTelefono] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [resultado, setResultado] = useState<AgenteRegistroOut | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!nombre.trim() || !telefono.trim()) { setError("Nombre y teléfono son obligatorios."); return; }
    setError("");
    setLoading(true);
    try {
      const res = await apiFetch<AgenteRegistroOut>(API_ENDPOINTS.agenteRegistro, {
        method: "POST",
        body: JSON.stringify({ nombre: nombre.trim(), telefono: telefono.trim() }),
      });
      setResultado(res);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error. Intenta de nuevo.");
    } finally {
      setLoading(false);
    }
  };

  if (resultado) {
    const mensaje = resultado.estado === "activo"
      ? "Tu cuenta de agente ya está activa."
      : resultado.estado === "rechazado"
      ? "Tu aplicación no fue aprobada. Escríbenos si crees que fue un error."
      : "Recibimos tu aplicación. La revisamos y te contactamos en 48 horas.";
    return (
      <AuthShell title="Aplicación de agente" subtitle="Estado de tu solicitud">
        <div className="space-y-4">
          <div className="rounded-lg border border-primary/40 bg-primary/10 p-4">
            <p className="text-sm text-foreground">{mensaje}</p>
          </div>
          <Link
            to="/planes"
            className="block w-full rounded-md bg-primary py-2.5 text-center text-sm font-semibold text-primary-foreground glow-cyan"
          >
            Volver a planes
          </Link>
        </div>
      </AuthShell>
    );
  }

  return (
    <AuthShell title="Regístrate como agente" subtitle="Cuéntanos quién eres para activar tu plan Agente">
      <form onSubmit={submit} className="space-y-4">
        <div>
          <label className="block text-[11px] font-medium uppercase tracking-widest text-muted-foreground">
            Nombre completo
          </label>
          <input
            value={nombre}
            onChange={(e) => setNombre(e.target.value)}
            className="mt-1 w-full rounded-md border border-border bg-background/40 px-3 py-2.5 text-sm outline-none focus:border-primary focus:ring-1 focus:ring-primary"
            placeholder="Tu nombre"
          />
        </div>
        <div>
          <label className="block text-[11px] font-medium uppercase tracking-widest text-muted-foreground">
            Teléfono (WhatsApp)
          </label>
          <input
            value={telefono}
            onChange={(e) => setTelefono(e.target.value)}
            className="mt-1 w-full rounded-md border border-border bg-background/40 px-3 py-2.5 text-sm outline-none focus:border-primary focus:ring-1 focus:ring-primary"
            placeholder="300 000 0000"
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
          {loading ? "Enviando…" : "Enviar aplicación"}
        </motion.button>
      </form>
    </AuthShell>
  );
}
