/** Returns the URL only if it parses as http(s); otherwise null.
 *  Use for every user/third-party supplied href/src (blocks javascript:, data:, etc.). */
export function safeHttpUrl(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const v = raw.trim();
  if (!v) return null;
  try {
    const u = new URL(v);
    return u.protocol === "http:" || u.protocol === "https:" ? u.toString() : null;
  } catch {
    return null;
  }
}
