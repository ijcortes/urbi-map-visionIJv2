import type { CSSProperties } from "react";
import { getGhlUrl, ghlRedirect, contactMailto, type GhlPlan } from "@/config/ghl";
import { K } from "@/design/tokens";

const base: CSSProperties = {
  display: "block", width: "100%", border: "none", borderRadius: 10, padding: "14px 0",
  minHeight: 44, fontWeight: 700, fontSize: 15, fontFamily: "inherit", marginBottom: 40,
  textAlign: "center", textDecoration: "none", boxSizing: "border-box",
};

/** Checkout button; renders a disabled "Próximamente" + contact link when no valid GHL URL. */
export function PlanCta({ plan, label, planLabel, params }: {
  plan: GhlPlan; label: string; planLabel: string; params?: Record<string, string | number>;
}) {
  if (!getGhlUrl(plan)) {
    return (
      <div data-testid={`plan-coming-soon-${plan}`} style={{ marginBottom: 40 }}>
        <button type="button" disabled aria-disabled="true"
          style={{ ...base, marginBottom: 10, background: K.faint, color: K.muted, cursor: "not-allowed" }}>
          Próximamente
        </button>
        <a href={contactMailto(planLabel)} style={{ display: "block", textAlign: "center", color: K.teal, fontSize: 14, fontWeight: 600, padding: "10px 0" }}>
          Contáctanos
        </a>
      </div>
    );
  }
  return (
    <button type="button" data-testid={`plan-cta-${plan}`} onClick={() => ghlRedirect(plan, params)}
      style={{ ...base, background: K.teal, color: "#fff", cursor: "pointer" }}>
      {label}
    </button>
  );
}
