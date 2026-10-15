import { seo } from "@/lib/seo";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { API_BASE_URL } from "@/config/api";
import { CheckCircle, XCircle, Loader2, Mail } from "@/lib/icons";

export const Route = createFileRoute("/verify-email")({
  component: VerifyEmailPage,
  head: () => seo({ title: "Confirma tu correo · Medellín Social", description: "Confirma tu correo para activar tu cuenta.", noindex: true }),
});

type Step = "loading" | "done" | "error";

function VerifyEmailPage() {
  const search =
    typeof window !== "undefined"
      ? new URLSearchParams(window.location.search)
      : new URLSearchParams();
  const token = search.get("token") ?? "";

  const [step, setStep] = useState<Step>("loading");
  const [errMsg, setErrMsg] = useState("");

  useEffect(() => {
    if (!token) {
      setErrMsg("Token inválido o faltante");
      setStep("error");
      return;
    }
    fetch(`${API_BASE_URL}/auth/verify-email?token=${encodeURIComponent(token)}`)
      .then(async (r) => {
        if (!r.ok) {
          const body = await r.json().catch(() => ({}));
          throw new Error(body.detail || "Error al verificar");
        }
        setStep("done");
      })
      .catch((e) => {
        setErrMsg((e as Error).message);
        setStep("error");
      });
  }, [token]);

  return (
    <div className="paper-theme grid min-h-screen place-items-center bg-background px-4">
      <div className="w-full max-w-sm rounded-xl border border-border bg-surface p-8 text-center shadow-sm">
        <div className="mb-4 inline-flex h-12 w-12 items-center justify-center rounded-full bg-primary/10">
          <Mail className="h-6 w-6 text-primary" />
        </div>

        {step === "loading" && (
          <>
            <Loader2 className="mx-auto h-8 w-8 animate-spin text-primary" />
            <p className="mt-3 text-sm text-muted-foreground">Verificando correo…</p>
          </>
        )}

        {step === "done" && (
          <>
            <CheckCircle className="mx-auto h-10 w-10 text-success" />
            <h1 className="mt-3 text-lg font-semibold text-foreground">
              ¡Correo verificado!
            </h1>
            <p className="mt-2 text-sm text-muted-foreground">
              Tu cuenta está activa. Ya puedes usar todas las funciones de Medellín Social.
            </p>
            <Link
              to="/map"
              className="mt-6 inline-block w-full rounded-lg bg-primary py-2.5 text-sm font-semibold text-primary-foreground transition hover:opacity-90"
            >
              Ir al mapa
            </Link>
          </>
        )}

        {step === "error" && (
          <>
            <XCircle className="mx-auto h-10 w-10 text-danger" />
            <h1 className="mt-3 text-lg font-semibold text-foreground">
              Enlace inválido
            </h1>
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
