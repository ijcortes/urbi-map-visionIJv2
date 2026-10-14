import { useState } from "react";
import { ExternalLink } from "@/lib/icons";
import { API_ENDPOINTS } from "@/config/api";
import { apiFetch } from "@/lib/apiClient";
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
  const [report, setReport] = useState<"idle" | "sending" | "ok" | "dup" | "err">("idle");
  const href = originalListingUrl(listing);
  if (!href) return null;
  const sendReport = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (listing?.id == null || report === "sending") return;
    setReport("sending");
    try {
      const j = await apiFetch<{ status: string }>(API_ENDPOINTS.listingReportBrokenLink(listing.id), { method: "POST", body: JSON.stringify({}) });
      setReport(j.status === "already_reported" ? "dup" : "ok");
    } catch {
      setReport("err");
    }
  };
  const portal = portalName(listing?.fuente);
  const base = "inline-flex items-center justify-center gap-1.5 font-semibold transition";
  const style: React.CSSProperties =
    variant === "primary"
      ? { background: "#0F8A4F", color: "#FFFFFF", border: "1px solid #0F8A4F", minHeight: 44, padding: "0 16px", borderRadius: 12, fontSize: 14 }
      : { background: "#FFFFFF", color: "#0A5C36", border: "1px solid #0F8A4F", minHeight: 32, padding: "0 10px", borderRadius: 8, fontSize: 11 };
  return (
    <span className="contents">
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
    {listing?.id != null && (
      <span data-testid="report-broken-link-wrap" className="block" style={{ fontSize: 11, marginTop: 4 }} onClick={(e) => e.stopPropagation()}>
        {report === "idle" || report === "sending" ? (
          <button type="button" data-testid="report-broken-link" onClick={sendReport} disabled={report === "sending"}
            style={{ background: "none", border: 0, padding: 0, color: "#6B7280", textDecoration: "underline", cursor: "pointer" }}>
            Reportar enlace roto
          </button>
        ) : (
          <span data-testid="report-broken-link-msg" style={{ color: report === "err" ? "#B42318" : "#0A5C36" }}>
            {report === "ok" ? "Gracias, revisaremos este enlace." : report === "dup" ? "Ya recibimos tu reporte de este enlace." : "No pudimos enviar el reporte. Inténtalo más tarde."}
          </span>
        )}
      </span>
    )}
    </span>
  );
}
