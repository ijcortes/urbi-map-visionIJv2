/**
 * GoHighLevel checkout links and displayed plan prices.
 * URLs come from VITE_GHL_* env vars. They are validated (https + hostname
 * allowlist) so a bad env value can never redirect users to an arbitrary site.
 */

export type GhlPlan =
  | "listing_member"
  | "featured_realtor"
  | "hot_spot"
  | "deal"
  | "business_pro"
  | "featured_realtor_a"
  | "featured_realtor_b";

const BASE_ALLOWED_HOSTS = ["leadconnectorhq.com", "msgsndr.com", "gohighlevel.com"];

/** Extra allowed hosts (comma separated), e.g. a white-label checkout domain. */
function extraHosts(): string[] {
  const raw = (import.meta.env?.VITE_GHL_EXTRA_HOSTS as string | undefined) ?? "";
  return raw.split(",").map((h) => h.trim().toLowerCase()).filter(Boolean);
}

export function allowedGhlHosts(): string[] {
  return [...BASE_ALLOWED_HOSTS, ...extraHosts()];
}

/** Returns a normalized URL string if `url` is https and on the allowlist, else null. */
export function validateGhlUrl(url: string | undefined | null, extra: string[] = extraHosts()): string | null {
  if (!url) return null;
  let u: URL;
  try { u = new URL(url.trim()); } catch { return null; }
  if (u.protocol !== "https:") return null;
  if (u.username || u.password) return null;
  const host = u.hostname.toLowerCase();
  const ok = [...BASE_ALLOWED_HOSTS, ...extra].some((h) => host === h || host.endsWith("." + h));
  return ok ? u.toString() : null;
}

const env = (k: string) => (import.meta.env?.[k] as string | undefined) ?? "";

/** Raw env values (unvalidated). Use getGhlUrl() to consume. */
export const GHL: Record<GhlPlan, string> = {
  listing_member: env("VITE_GHL_LISTING_MEMBER_URL"),
  featured_realtor: env("VITE_GHL_FEATURED_REALTOR_URL"),
  hot_spot: env("VITE_GHL_HOT_SPOT_URL"),
  deal: env("VITE_GHL_DEAL_URL"),
  business_pro: env("VITE_GHL_BUSINESS_PRO_URL"),
  featured_realtor_a: env("VITE_GHL_FEATURED_REALTOR_A_URL"),
  featured_realtor_b: env("VITE_GHL_FEATURED_REALTOR_B_URL"),
};

/** Valid checkout URL for a plan, or null when empty/invalid ("coming soon"). */
export function getGhlUrl(plan: GhlPlan): string | null {
  return validateGhlUrl(GHL[plan]);
}

/** Contact address shown when a checkout link is not available yet. */
export const GHL_CONTACT_EMAIL = "hola@medellin.social";

export function contactMailto(planLabel: string): string {
  return `mailto:${GHL_CONTACT_EMAIL}?subject=${encodeURIComponent(`Plan ${planLabel}`)}`;
}

/**
 * Single source of truth for displayed prices. Only existing prices are listed;
 * Business Pro / Featured Realtor A / B have no approved price, so none is shown.
 */
export const PLAN_PRICES: Partial<Record<GhlPlan, { regular?: string; special: string; setup?: string }>> = {
  listing_member: { regular: "$399", special: "$149", setup: "$150" },
  featured_realtor: { regular: "$599", special: "$299", setup: "$199" },
  hot_spot: { regular: "$299", special: "$199", setup: "$49" },
  deal: { special: "$29" },
};

/**
 * Redirects to GHL with optional params. Returns false (and does nothing)
 * when the URL is missing or invalid, so callers show the "coming soon" state.
 */
export function ghlRedirect(plan: GhlPlan, params: Record<string, string | number> = {}): boolean {
  const url = getGhlUrl(plan);
  if (!url) return false;
  const u = new URL(url);
  for (const [k, v] of Object.entries(params)) u.searchParams.set(k, String(v));
  window.location.href = u.toString();
  return true;
}
