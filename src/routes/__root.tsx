import { Outlet, createRootRoute, HeadContent, Scripts } from "@tanstack/react-router";
import { Link } from "@tanstack/react-router";
import { useEffect } from "react";
import { LanguageProvider } from "@/lib/i18n";
import { refreshIfExpiringSoon } from "@/lib/auth";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/sonner";
import { OnboardingModal } from "@/components/OnboardingModal";
import { TargetProvider } from "@/contexts/TargetContext";
import { initSentry } from "@/lib/sentry";
import { API_BASE_URL } from "@/config/api";

initSentry();

// After a deploy the old chunk filenames disappear: a lazy route import then fails. Reload once
// (guarded so a genuinely broken chunk cannot cause a reload loop) to pick up the new build.
if (typeof window !== "undefined") {
  window.addEventListener("vite:preloadError", (event) => {
    event.preventDefault();
    try {
      const k = "ms.preloadReloadAt";
      const last = Number(sessionStorage.getItem(k) || 0);
      if (Date.now() - last < 60_000) return;
      sessionStorage.setItem(k, String(Date.now()));
    } catch { /* storage blocked: fall through, a single reload is still safe */ }
    window.location.reload();
  });
}

const API_ORIGIN = (() => {
  try { return new URL(API_BASE_URL).origin; } catch { return null; }
})();
const BUILD_ID = (import.meta.env.VITE_BUILD_ID as string | undefined) ?? "dev";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 5 * 60 * 1000, retry: 1 },
  },
});

import appCss from "../styles.css?url";

const NF = {
  ink: "#111418",
  muted: "#5B5F5C",
  teal: "#0F8A4F",
  tealDeep: "#0A5C36",
  tealLight: "#E7F4EC",
  coral: "#CE1126",
  serif: "'Fraunces', Georgia, serif" as const,
};

function NotFoundComponent() {
  return (
    <div
      className="paper-theme"
      style={{
        minHeight: "100dvh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "#FAF8F3",
        padding: 20,
      }}
    >
      <div style={{ maxWidth: 480, width: "100%", textAlign: "center" }}>
        <svg
          viewBox="0 0 20 28"
          style={{ width: 72, height: 100, margin: "0 auto 16px" }}
          aria-hidden="true"
        >
          <path
            d="M10 2 C4 2 1 6 1 11 C1 17 10 26 10 26 C10 26 19 17 19 11 C19 6 16 2 10 2 Z"
            fill={NF.coral}
          />
          <text x="10" y="15.5" textAnchor="middle" fontSize="8" fontWeight={900} fill="#FAF8F3" fontFamily={NF.serif}>
            ?
          </text>
        </svg>

        <h1 style={{ fontFamily: NF.serif, fontSize: "3rem", fontWeight: 900, color: NF.ink, margin: 0, letterSpacing: "-1px" }}>
          404
        </h1>
        <h2 style={{ fontFamily: NF.serif, fontSize: "1.25rem", fontWeight: 700, color: NF.ink, marginTop: 8 }}>
          Esta página no existe
        </h2>
        <p style={{ color: NF.muted, fontSize: 15, lineHeight: 1.7, marginTop: 10, marginBottom: 32 }}>
          Puede que el enlace esté roto o la página se haya movido. Vuelve al mapa para seguir explorando Medellín.
        </p>

        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <Link
            to="/map"
            style={{
              background: NF.teal, color: "#fff",
              padding: "13px 24px", borderRadius: 8,
              fontWeight: 700, fontSize: 14, textDecoration: "none",
              display: "block",
            }}
          >
            Ir al mapa →
          </Link>
          <Link
            to="/"
            style={{
              background: NF.tealLight, color: NF.tealDeep,
              padding: "11px 24px", borderRadius: 8,
              fontWeight: 700, fontSize: 13, textDecoration: "none",
              display: "block",
            }}
          >
            Volver al inicio
          </Link>
        </div>
      </div>
    </div>
  );
}

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1, viewport-fit=cover" },
      { name: "apple-mobile-web-app-capable", content: "yes" },
      { name: "apple-mobile-web-app-status-bar-style", content: "black-translucent" },
      { title: "Medellín Social · Where Smart Investors Meet Local Culture" },
      { name: "description", content: "The only platform that combines real estate intelligence with authentic local experiences in Medellín and the Aburrá Valley." },
      { name: "author", content: "Medellín Social" },
      { name: "build-id", content: BUILD_ID },
      // App traduce sola (i18n propio + Chrome Translator API). Desactiva el
      // auto-translate de página del navegador: muta text nodes y crashea el
      // reconciler de React. No afecta nuestra traducción JS.
      { name: "google", content: "notranslate" },
      { property: "og:title", content: "Medellín Social · Where Smart Investors Meet Local Culture" },
      { property: "og:description", content: "Real estate intelligence meets local culture in Medellín and the Aburrá Valley." },
      { property: "og:image", content: "https://urbidata.co/og-image.png" },
      { name: "twitter:image", content: "https://urbidata.co/og-image.png" },
      { property: "og:url", content: "https://urbidata.co" },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
    links: [
      { rel: "icon", href: "/favicon.svg", type: "image/svg+xml" },
      { rel: "stylesheet", href: appCss },
      // Mapbox — bundled CSS used instead of CDN to avoid version mismatch (v3.7 vs v3.23)
      ...(API_ORIGIN ? [{ rel: "preconnect", href: API_ORIGIN, crossOrigin: "anonymous" as const }] : []),
      { rel: "preconnect", href: "https://api.mapbox.com" },
      { rel: "preconnect", href: "https://events.mapbox.com" },
      { rel: "dns-prefetch", href: "https://a.tiles.mapbox.com" },
      { rel: "dns-prefetch", href: "https://b.tiles.mapbox.com" },
      { rel: "dns-prefetch", href: "https://c.tiles.mapbox.com" },
      { rel: "dns-prefetch", href: "https://d.tiles.mapbox.com" },
      { rel: "preconnect", href: "https://fonts.googleapis.com" },
      { rel: "preconnect", href: "https://fonts.gstatic.com", crossOrigin: "anonymous" },
      { rel: "stylesheet", href: "https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Fraunces:opsz,wght@9..144,400;9..144,600;9..144,900&display=swap" },
    ],
  }),
  shellComponent: RootShell,
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
});

function RootShell({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es" translate="no" className="dark" suppressHydrationWarning>
      <head>
        {/* Set <html lang> from the stored choice before first paint (no ES flash on the root attribute). */}
        <script
          dangerouslySetInnerHTML={{
            __html: `try{var m=document.cookie.match(/(?:^|; )medellin-social\\.lang=(en|es)/),l=localStorage.getItem("medellin-social.lang")||(m&&m[1]);if(l==="en"||l==="es")document.documentElement.lang=l}catch(e){}`,
          }}
        />
        <HeadContent />
      </head>
      <body className="bg-background text-foreground">
        {children}
        <Scripts />
      </body>
    </html>
  );
}

function RootComponent() {
  useEffect(() => { refreshIfExpiringSoon(); }, []);

  return (
    <QueryClientProvider client={queryClient}>
      <LanguageProvider>
        <TargetProvider>
          <Outlet />
          <OnboardingModal />
          <Toaster />
        </TargetProvider>
      </LanguageProvider>
    </QueryClientProvider>
  );
}
