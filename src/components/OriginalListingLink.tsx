import { ExternalLink } from "@/lib/icons";
import { originalListingUrl, portalName, type OriginalListingSource } from "@/lib/originalListing";

/**
 * Primary "View original listing" link. Renders nothing when there is no external URL
 * (fuente propio / missing url). Always opens in a new tab with noopener noreferrer.
 */
export function OriginalListingLink({
  listing,
  variant = "primary",
  className = "",
  onClick,
}: {
  listing: OriginalListingSource | null | undefined;
  variant?: "primary" | "compact";
  className?: string;
  onClick?: (e: React.MouseEvent) => void;
}) {
  const href = originalListingUrl(listing);
  if (!href) return null;
  const portal = portalName(listing?.fuente);
  const base = "inline-flex items-center justify-center gap-1.5 font-semibold transition";
  const style: React.CSSProperties =
    variant === "primary"
      ? { background: "#0F8A4F", color: "#FFFFFF", border: "1px solid #0F8A4F", minHeight: 44, padding: "0 16px", borderRadius: 12, fontSize: 14 }
      : { background: "#FFFFFF", color: "#0A5C36", border: "1px solid #0F8A4F", minHeight: 32, padding: "0 10px", borderRadius: 8, fontSize: 11 };
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      data-testid="original-listing-link"
      onClick={(e) => { e.stopPropagation(); onClick?.(e); }}
      className={`${base} ${className}`}
      style={style}
    >
      <ExternalLink className={variant === "primary" ? "h-4 w-4" : "h-3 w-3"} />
      <span>Ver publicación original</span>
      {portal && variant === "primary" && <span data-i18n-skip style={{ opacity: 0.85, fontWeight: 500 }}>· {portal}</span>}
    </a>
  );
}
