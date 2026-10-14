// @lovable.dev/vite-tanstack-config already includes the following — do NOT add them manually
// or the app will break with duplicate plugins:
//   - tanstackStart, viteReact, tailwindcss, tsConfigPaths, cloudflare (build-only),
//     componentTagger (dev-only), VITE_* env injection, @ path alias, React/TanStack dedupe,
//     error logger plugins, and sandbox detection (port/host/strictPort).
// You can pass additional config via defineConfig({ vite: { ... } }) if needed.
import { execSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { defineConfig } from "@lovable.dev/vite-tanstack-config";

// Build id = git sha. Docker/Railway has no .git, so prefer the sha passed in as an env/ARG.
function buildId(): string {
  const fromEnv = process.env.VITE_BUILD_ID || process.env.RAILWAY_GIT_COMMIT_SHA;
  if (fromEnv) return fromEnv.slice(0, 12);
  try {
    return execSync("git rev-parse --short=12 HEAD", { stdio: ["ignore", "pipe", "ignore"] }).toString().trim();
  } catch {
    return `local-${Date.now().toString(36)}`;
  }
}
const BUILD_ID = buildId();
const BUILT_AT = new Date().toISOString();

export default defineConfig({
  cloudflare: false,
  vite: {
    define: {
      "import.meta.env.VITE_BUILD_ID": JSON.stringify(BUILD_ID),
    },
    plugins: [
      {
        // server.mjs reads dist/client/version.json for /version and the X-Build-Id header.
        name: "write-version-json",
        apply: "build",
        closeBundle() {
          try {
            mkdirSync("dist/client", { recursive: true });
            writeFileSync("dist/client/version.json", JSON.stringify({ build: BUILD_ID, builtAt: BUILT_AT }));
          } catch { /* dist/client not created in this build step */ }
        },
      },
    ],
  },
});
