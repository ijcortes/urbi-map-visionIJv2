/** Classify the admin-gate failure so every case is a redirect or a visible message (never blank). */
export function adminGateErrorKind(msg: string): "login" | "forbidden" | "other" {
  if (/401|sesi[oó]n expirada|not authenticated|credenciales/i.test(msg)) return "login";
  if (/403|no autorizado|forbidden/i.test(msg)) return "forbidden";
  return "other";
}
