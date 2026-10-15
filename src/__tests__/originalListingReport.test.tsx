import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const apiFetch = vi.fn();
vi.mock("@/lib/apiClient", () => ({ apiFetch: (...a: unknown[]) => apiFetch(...a) }));

import { OriginalListingLink } from "@/components/OriginalListingLink";
import { originalListingUrl } from "@/lib/originalListing";
import { PHRASES } from "@/lib/i18n-phrases";

const L = { id: 42, url: "https://www.fincaraiz.com.co/x/1", fuente: "fincaraiz", link_status: "ok" };

describe("original listing link health", () => {
  beforeEach(() => apiFetch.mockReset());

  it("hides the link when the API says it is dead or under review", () => {
    for (const s of ["gone", "pending_review", "error"])
      expect(originalListingUrl({ ...L, link_status: s })).toBeNull();
    for (const s of ["ok", "unknown", "redirected", undefined])
      expect(originalListingUrl({ ...L, link_status: s })).toContain("fincaraiz");
  });

  it("renders nothing (no report action either) for a dead link", () => {
    const { container } = render(<OriginalListingLink listing={{ ...L, link_status: "gone" }} />);
    expect(container.textContent).toBe("");
  });

  it("report action posts once and shows a graceful message", async () => {
    apiFetch.mockResolvedValue({ status: "reported", reports: 1 });
    render(<OriginalListingLink listing={L} />);
    fireEvent.click(screen.getByTestId("report-broken-link"));
    await waitFor(() => expect(screen.getByTestId("report-broken-link-msg").textContent).toContain("Gracias"));
    expect(apiFetch).toHaveBeenCalledTimes(1);
    expect(apiFetch.mock.calls[0][0]).toContain("/listings/42/report-broken-link");
    expect(apiFetch.mock.calls[0][1].method).toBe("POST");
  });

  it("handles duplicate and failure responses", async () => {
    apiFetch.mockResolvedValue({ status: "already_reported" });
    const { unmount } = render(<OriginalListingLink listing={L} />);
    fireEvent.click(screen.getByTestId("report-broken-link"));
    await waitFor(() => expect(screen.getByTestId("report-broken-link-msg").textContent).toContain("Ya recibimos"));
    unmount();
  });

  it("shows a graceful message when the request fails", async () => {
    // malformed/failed response (null body) must degrade to the error message, not crash
    apiFetch.mockResolvedValue(null);
    render(<OriginalListingLink listing={L} />);
    fireEvent.click(screen.getByTestId("report-broken-link"));
    await waitFor(() => expect(screen.getByTestId("report-broken-link-msg").textContent).toContain("No pudimos"));
  });

  it("every new Spanish phrase has an English translation", () => {
    const map = new Map(PHRASES);
    for (const es of ["Reportar enlace roto", "Gracias, revisaremos este enlace.", "Ya recibimos tu reporte de este enlace.", "No pudimos enviar el reporte. Inténtalo más tarde."])
      expect(map.get(es)).toBeTruthy();
  });
});
