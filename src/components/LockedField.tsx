import { useEffect, useState } from "react";
import { auth } from "@/lib/auth";

// No Pro plan anymore — the MLS is free for everyone. Ex-Pro data fields
// (price range, historial, yield) are open to all. Comparador and Simulador
// are agent-only again (gated via beforeLoad + isAgente, not this flag) — see
// AGENTE_TABS in MapNavbar.tsx. The only other agent-exclusive data
// (buena_oferta / pct_bajo_mediana) is gated server-side (nulled for
// non-agents), so those badges hide via missing data, not this flag.
// Kept as a hook so the existing `isPro` call sites need no change.
export function useIsPro(): boolean {
  return true;
}

// True for the "agente" paid plan OR a real agent/agency row (mirrors
// api/dependencies.py:is_agente) — covers both agente y agencia accounts,
// since agency owners/members are agent rows too.
function _checkIsAgente(): boolean {
  const u = auth.get();
  return u?.plan === "agente" || u?.esAgente === true;
}

export function useIsAgente(): boolean {
  // Starts false (matches SSR, which has no localStorage) and only reads the
  // real value after mount — reading synchronously in the initializer makes
  // the client's first render diverge from the server's, which React treats
  // as a hydration mismatch and recovers from by discarding/rebuilding the
  // subtree (visible as corrupted layout height on pages that branch on this).
  const [isAgente, setIsAgente] = useState(false);
  useEffect(() => {
    setIsAgente(_checkIsAgente());
    const handler = () => setIsAgente(_checkIsAgente());
    window.addEventListener("medellin-social:user", handler);
    return () => window.removeEventListener("medellin-social:user", handler);
  }, []);
  return isAgente;
}

// Puerta del DETALLE del entorno (ruido/servicios/verde/valor estimado/obras).
// DECISIÓN DE NEGOCIO (usuario, nov-2026): HOY NO hay tier de pago al consumidor →
// "suscrito" = "registrado" (logueado). Con solo registrarse se desbloquea el
// detalle (el CTA del drawer ya lo promete: "Regístrate gratis y desbloquea el
// detalle del entorno"). El anónimo ve los 4 scores públicos y el lock.
// Cuando exista un plan pagado, volver a gatear por plan ('pro'/'agente') acá.
// NOTA: esto solo OCULTA en el cliente; el gate real sería nullear los campos en
// el backend para no-registrados (patrón de buena_oferta). Pend server-side.
function _checkSuscriptor(): boolean {
  return auth.get() != null;
}
export function useIsSuscriptor(): boolean {
  const [v, setV] = useState(false);
  useEffect(() => {
    setV(_checkSuscriptor());
    const h = () => setV(_checkSuscriptor());
    window.addEventListener("medellin-social:user", h);
    return () => window.removeEventListener("medellin-social:user", h);
  }, []);
  return v;
}

// Nivel REGISTRADO (inversionista): logueado, sin importar plan. Mismo patrón
// post-mount que useIsAgente para no romper la hidratación SSR.
export function useIsRegistered(): boolean {
  const [registered, setRegistered] = useState(false);
  useEffect(() => {
    const read = () => setRegistered(auth.get() != null);
    read();
    window.addEventListener("medellin-social:user", read);
    return () => window.removeEventListener("medellin-social:user", read);
  }, []);
  return registered;
}
