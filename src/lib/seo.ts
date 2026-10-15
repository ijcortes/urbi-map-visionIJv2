// Per-route <head>: title, description, canonical URL and the matching Open Graph /
// Twitter tags. The root route only sets site-wide defaults; every public page
// passes its own text here so shared links do not all show the home page card.
export const SITE_URL = ((import.meta.env.VITE_SITE_URL as string | undefined) || "https://medellinsocial.com").replace(/\/+$/, "");
export const OG_IMAGE = `${SITE_URL}/og-image.png`;

interface SeoInput {
  title: string;
  description: string;
  /** Path of the canonical URL, e.g. "/map". Omit for pages that must not be indexed. */
  path?: string;
  noindex?: boolean;
}

export function seo({ title, description, path, noindex }: SeoInput) {
  const url = path != null ? `${SITE_URL}${path}` : undefined;
  return {
    meta: [
      { title },
      { name: "description", content: description },
      { property: "og:title", content: title },
      { property: "og:description", content: description },
      ...(url ? [{ property: "og:url", content: url }] : []),
      { name: "twitter:title", content: title },
      { name: "twitter:description", content: description },
      ...(noindex ? [{ name: "robots", content: "noindex, nofollow" }] : []),
    ],
    links: url ? [{ rel: "canonical", href: url }] : [],
  };
}
