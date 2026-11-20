import { describe, it, expect } from "vitest";
import { scaleRatio } from "@/lib/entornoScale";

// Umbrales de color del FactCircle: >=0.66 verde, >=0.33 ámbar, <0.33 rojo.
const color = (r: number) => (r >= 0.66 ? "verde" : r >= 0.33 ? "ambar" : "rojo");

describe("scaleRatio — calibración por percentil real", () => {
  it("verde: 3% (sobre la mediana 2.4%) NO es rojo; 0% rojo; 12%+ verde", () => {
    expect(color(scaleRatio(3, "verde"))).not.toBe("rojo"); // el bug que reportó el usuario
    expect(color(scaleRatio(0, "verde"))).toBe("rojo");
    expect(color(scaleRatio(12, "verde"))).toBe("verde");
    expect(color(scaleRatio(59, "verde"))).toBe("verde");
  });

  it("ruido (menos=mejor): barrio silencioso verde, ruidoso rojo", () => {
    expect(color(scaleRatio(50, "ruido"))).toBe("verde");   // < p10 (55.6) = silencioso
    expect(color(scaleRatio(70, "ruido"))).toBe("rojo");    // >= p90 (69.4) = avenida
    expect(scaleRatio(50, "ruido")).toBeGreaterThan(scaleRatio(68, "ruido")); // monotonía
  });

  it("metro (menos dist=mejor): cerca verde, lejos rojo", () => {
    expect(color(scaleRatio(0.4, "metro"))).toBe("verde");  // ~p10 pegado al metro
    expect(color(scaleRatio(3.0, "metro"))).toBe("rojo");   // > p90 lejísimos
    expect(scaleRatio(0.4, "metro")).toBeGreaterThan(scaleRatio(2.0, "metro"));
  });

  it("dir high vs low invierten correctamente", () => {
    // internet (más=mejor): valor alto = verde
    expect(color(scaleRatio(330, "internet"))).toBe("verde");
    expect(color(scaleRatio(235, "internet"))).toBe("rojo"); // p10 = lento relativo
  });
});
