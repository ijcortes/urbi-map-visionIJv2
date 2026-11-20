import { describe, it, expect } from "vitest";
import { zonePriceTrend, calcValorizStats, DANE_VARS, DANE_FIRST_YEAR } from "@/lib/valoriz";

describe("zonePriceTrend", () => {
  it("ancla el último punto al precio actual y da 11 puntos crecientes", () => {
    const serie = zonePriceTrend(500_000_000, 5);
    expect(serie.length).toBe(DANE_VARS.length); // 11 años 2015..2025
    expect(serie[serie.length - 1].precio).toBe(500_000_000); // ancla = precio actual
    expect(serie[0].year).toBe(DANE_FIRST_YEAR);
    expect(serie[serie.length - 1].year).toBe(DANE_FIRST_YEAR + DANE_VARS.length - 1);
    // DANE_VARS todos positivos → precio sube año a año (back-calc = pasado más barato)
    for (let i = 1; i < serie.length; i++) {
      expect(serie[i].precio).toBeGreaterThan(serie[i - 1].precio);
    }
  });

  it("estrato más alto = multiplicador mayor = pasado relativamente más barato", () => {
    const e5 = zonePriceTrend(500_000_000, 5)[0].precio;
    const e3 = zonePriceTrend(500_000_000, 3)[0].precio;
    expect(e5).toBeLessThan(e3); // más valorización ⇒ arranca más abajo para llegar al mismo hoy
  });

  it("calcValorizStats: acumulado > último año, proyección positiva", () => {
    const s = calcValorizStats(5);
    expect(s.acumulado).toBeGreaterThan(s.ultimoAnio);
    expect(s.proj5).toBeGreaterThan(0);
  });
});
