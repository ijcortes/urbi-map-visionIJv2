import { seo } from "@/lib/seo";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { apiFetch } from "@/lib/apiClient";
import { API_BASE_URL } from "@/config/api";
import { Skeleton } from "@/components/ui/skeleton";
import { Building2, CheckCircle, XCircle } from "@/lib/icons";

export const Route = createFileRoute("/realtor/accept-invite")({
  component: AcceptInvitePage,
  head: () => seo({ title: "Invitación de agencia · Medellín Social", description: "Acepta la invitación de tu agencia.", noindex: true }),
});

type InviteInfo = { agency_nombre: string; email: string; estado: string };
type Step = "loading" | "info" | "needs_login" | "accepting" | "done" | "error";

function AcceptInvitePage() {
  const navigate = useNavigate();
  const search = typeof window !== "undefined" ? new URLSearchParams(window.location.search) : new URLSearchParams();
  const token = search.get("token") ?? "";

  const [step, setStep] = useState<Step>("loading");
  const [invite, setInvite] = useState<InviteInfo | null>(null);
  const [errMsg, setErrMsg] = useState("");
  const [yaMiembro, setYaMiembro] = useState(false);

  // Fetch invite info
  useEffect(() => {
    if (!token) { setStep("error"); setErrMsg("Token inválido"); return; }
    apiFetch<InviteInfo>(`${API_BASE_URL}/agency/invite/${token}`)
      .then((d) => { setInvite(d); setStep("info"); })
      .catch(() => { setStep("error"); setErrMsg("Invitación no encontrada o expirada"); });
  }, [token]);

  const isLoggedIn = () => {
    try { return !!localStorage.getItem("medellin-social.user"); } catch { return false; }
  };

  const aceptar = async () => {
    if (!isLoggedIn()) { setStep("needs_login"); return; }
    setStep("accepting");
    try {
      const r = await apiFetch<{ ok: boolean; ya_miembro: boolean }>(
        `${API_BASE_URL}/agency/invite/${token}/aceptar`,
        { method: "POST" },
      );
      setYaMiembro(r.ya_miembro);
      setStep("done");
    } catch {
      setStep("error");
      setErrMsg("No se pudo aceptar la invitación. Intenta de nuevo.");
    }
  };

  return (
    <div className="paper-theme grid min-h-screen place-items-center bg-background px-4">
      <div className="w-full max-w-sm rounded-xl border border-border bg-surface p-8 text-center shadow-sm">
        <div className="mb-4 inline-flex h-12 w-12 items-center justify-center rounded-full bg-primary/10">
          <Building2 className="h-6 w-6 text-primary" />
        </div>

        {step === "loading" && (
          <>
            <Skeleton className="mx-auto h-5 w-48" />
            <Skeleton className="mx-auto mt-3 h-4 w-64" />
            <Skeleton className="mx-auto mt-6 h-10 w-40" />
          </>
        )}

        {step === "info" && invite && (
          <>
            <h1 className="text-lg font-semibold text-foreground">
              Invitación de agencia
            </h1>
            <p className="mt-2 text-sm text-muted-foreground">
              Te invitaron a unirte a
            </p>
            <p className="mt-1 text-xl font-bold text-foreground">{invite.agency_nombre}</p>
            <p className="mt-3 text-xs text-muted-foreground">
              La invitación es para <span className="font-medium text-foreground">{invite.email}</span>
            </p>
            <button
              onClick={aceptar}
              className="mt-6 w-full rounded-lg bg-primary py-2.5 text-sm font-semibold text-primary-foreground transition hover:opacity-90"
            >
              Aceptar e ingresar al equipo
            </button>
            <p className="mt-3 text-xs text-muted-foreground">
              Al aceptar quedarás como agente miembro de esta agencia.
            </p>
          </>
        )}

        {step === "needs_login" && (
          <>
            <h1 className="text-lg font-semibold text-foreground">Inicia sesión primero</h1>
            <p className="mt-2 text-sm text-muted-foreground">
              Necesitas una cuenta para aceptar la invitación.
            </p>
            <div className="mt-6 flex flex-col gap-2">
              <Link
                to="/login"
                search={{ redirect: `/realtor/accept-invite?token=${token}` } as Record<string, string>}
                className="w-full rounded-lg bg-primary py-2.5 text-sm font-semibold text-primary-foreground transition hover:opacity-90 text-center"
              >
                Iniciar sesión
              </Link>
              <Link
                to="/register"
                className="w-full rounded-lg border border-border py-2.5 text-sm font-medium text-foreground transition hover:bg-muted/40 text-center"
              >
                Crear cuenta
              </Link>
            </div>
          </>
        )}

        {step === "accepting" && (
          <>
            <Skeleton className="mx-auto h-5 w-40" />
            <p className="mt-3 text-sm text-muted-foreground">Procesando…</p>
          </>
        )}

        {step === "done" && (
          <>
            <CheckCircle className="mx-auto h-10 w-10 text-success" />
            <h1 className="mt-3 text-lg font-semibold text-foreground">
              {yaMiembro ? "Ya eres miembro" : "¡Bienvenido al equipo!"}
            </h1>
            <p className="mt-2 text-sm text-muted-foreground">
              {yaMiembro
                ? `Ya formas parte de ${invite?.agency_nombre}.`
                : `Te uniste exitosamente a ${invite?.agency_nombre}.`}
            </p>
            <button
              onClick={() => navigate({ to: "/realtor/dashboard" })}
              className="mt-6 w-full rounded-lg bg-primary py-2.5 text-sm font-semibold text-primary-foreground transition hover:opacity-90"
            >
              Ir a mi dashboard
            </button>
          </>
        )}

        {step === "error" && (
          <>
            <XCircle className="mx-auto h-10 w-10 text-danger" />
            <h1 className="mt-3 text-lg font-semibold text-foreground">Invitación inválida</h1>
            <p className="mt-2 text-sm text-muted-foreground">{errMsg}</p>
            <Link
              to="/map"
              className="mt-6 inline-block rounded-lg border border-border px-4 py-2 text-sm font-medium text-muted-foreground transition hover:text-foreground"
            >
              Volver al mapa
            </Link>
          </>
        )}
      </div>
    </div>
  );
}
