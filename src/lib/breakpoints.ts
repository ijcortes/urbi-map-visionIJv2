// Single source of truth for responsive breakpoints (px). Tailwind `md` = 768, `lg` = 1024.
export const BREAKPOINTS = {
  /** < MOBILE_MAX: phone layout (bottom sheets, single column). */
  mobile: 768,
  /** < TABLET_MAX: phone + tablet portrait (wide valley fit). */
  tablet: 1024,
} as const;

export const MOBILE_QUERY = `(max-width: ${BREAKPOINTS.mobile - 1}px)`;
export const TABLET_QUERY = `(max-width: ${BREAKPOINTS.tablet - 1}px)`;

export function isMobileWidth(w: number): boolean {
  return w < BREAKPOINTS.mobile;
}
export function isTabletWidth(w: number): boolean {
  return w < BREAKPOINTS.tablet;
}
