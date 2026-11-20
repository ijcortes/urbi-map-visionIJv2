import { seo } from "@/lib/seo";
import { createFileRoute, Link, redirect } from "@tanstack/react-router";
import { useState } from "react";
import { apiFetch } from "@/lib/apiClient";
import { API_ENDPOINTS } from "@/config/api";
import { AuthShell, Field, ErrorBanner, AuthButton, inputStyle } from "./login";

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
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <div style={{ borderRadius: 10, border: "1px solid #0F8A4F", background: "#E7F4EC", padding: 16, fontSize: 14, color: "#0A5C36", fontFamily: "'Inter', system-ui, sans-serif", lineHeight: 1.6 }}>
            {mensaje}
          </div>
          <Link
            to="/planes"
            style={{ display: "block", width: "100%", background: "#0F8A4F", color: "#fff", padding: "13px", borderRadius: 999, textAlign: "center", fontSize: 14, fontWeight: 800, textDecoration: "none", fontFamily: "'Inter', system-ui, sans-serif" }}
          >
            Volver a planes
          </Link>
        </div>
      </AuthShell>
    );
  }

  return (
    <AuthShell title="Regístrate como agente" subtitle="Cuéntanos quién eres para activar tu plan Agente">
      <form onSubmit={submit} style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        <Field label="Nombre completo">
          <input
            value={nombre}
            onChange={(e) => setNombre(e.target.value)}
            className="auth-input"
            style={inputStyle}
            placeholder="Tu nombre"
          />
        </Field>
        <Field label="Teléfono (WhatsApp)">
          <input
            type="tel"
            value={telefono}
            onChange={(e) => setTelefono(e.target.value)}
            className="auth-input"
            style={inputStyle}
            placeholder="300 000 0000"
          />
        </Field>
        {error && <ErrorBanner message={error} />}
        <AuthButton disabled={loading}>
          {loading ? "Enviando…" : "Enviar aplicación"}
        </AuthButton>
      </form>
    </AuthShell>
  );
}
