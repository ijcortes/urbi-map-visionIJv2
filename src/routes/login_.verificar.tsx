import { seo } from "@/lib/seo";
import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useMagicLinkVerify } from "@/hooks/useAuth";
import { CheckCircle, XCircle, Loader2, Mail } from "@/lib/icons";

export const Route = createFileRoute("/login_/verificar")({
  component: MagicLinkVerifyPage,
  head: () => seo({ title: "Ingresando… · Medellín Social", description: "Verificando tu enlace de acceso.", noindex: true }),
});

type Step = "loading" | "done" | "error";

function MagicLinkVerifyPage() {
  const navigate = useNavigate();
  const verify = useMagicLinkVerify();
  const search =
    typeof window !== "undefined"
      ? new URLSearchParams(window.location.search)
      : new URLSearchParams();
  const token = search.get("token") ?? "";

  const [step, setStep] = useState<Step>("loading");
  const [errMsg, setErrMsg] = useState("");

  useEffect(() => {
    if (!token) {
      setErrMsg("Link inválido o incompleto");
      setStep("error");
      return;
    }
    verify
      .mutateAsync({ token })
      .then(() => {
        setStep("done");
        setTimeout(() => navigate({ to: "/map" }), 1200);
      })
      .catch((e) => {
        setErrMsg(e instanceof Error ? e.message : "No se pudo verificar el link");
        setStep("error");
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
            <p className="mt-3 text-sm text-muted-foreground">Ingresando…</p>
          </>
        )}

        {step === "done" && (
          <>
            <CheckCircle className="mx-auto h-10 w-10 text-success" />
            <h1 className="mt-3 text-lg font-semibold text-foreground">¡Listo!</h1>
            <p className="mt-2 text-sm text-muted-foreground">Ya entraste. Te llevamos al mapa…</p>
          </>
        )}

        {step === "error" && (
          <>
            <XCircle className="mx-auto h-10 w-10 text-danger" />
            <h1 className="mt-3 text-lg font-semibold text-foreground">Link inválido</h1>
            <p className="mt-2 text-sm text-muted-foreground">{errMsg}</p>
            <Link
              to="/login"
              className="mt-6 inline-block w-full rounded-lg bg-primary py-2.5 text-sm font-semibold text-primary-foreground transition hover:opacity-90"
            >
              Volver a ingresar
            </Link>
          </>
        )}
      </div>
    </div>
  );
}
