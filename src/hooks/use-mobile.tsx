import * as React from "react";
import { BREAKPOINTS, MOBILE_QUERY, TABLET_QUERY } from "@/lib/breakpoints";

// Re-exported so existing imports keep working; the value lives in lib/breakpoints.
export const MOBILE_BREAKPOINT = BREAKPOINTS.mobile;

function makeMatchMediaHook(query: string) {
  const subscribe = (cb: () => void) => {
    if (typeof window === "undefined" || !window.matchMedia) return () => {};
    const mql = window.matchMedia(query);
    mql.addEventListener("change", cb);
    return () => mql.removeEventListener("change", cb);
  };
  // Client snapshot reads matchMedia synchronously on the very first render, so a
  // client-side mount never renders the wrong tree. During hydration React uses the
  // server snapshot (false) and re-renders synchronously before paint if it differs.
  const getSnapshot = () =>
    typeof window !== "undefined" && !!window.matchMedia && window.matchMedia(query).matches;
  const getServerSnapshot = () => false;
  return function useMatch() {
    return React.useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  };
}

/** < 768px (phone). Tailwind `md:` agrees with this threshold. */
export const useIsMobile = makeMatchMediaHook(MOBILE_QUERY);
/** < 1024px (phone + tablet portrait). Tailwind `lg:`. */
export const useIsTablet = makeMatchMediaHook(TABLET_QUERY);
