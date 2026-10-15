import { describe, expect, it } from "vitest";
import { formatAntiguedad } from "./antiguedad";

describe("formatAntiguedad (LNG-13)", () => {
  it("renders each portal shape in both languages", () => {
    expect(formatAntiguedad("Entre 5 y 10 años", "en")).toBe("5–10 years old");
    expect(formatAntiguedad("Entre 5 y 10 años", "es")).toBe("Entre 5 y 10 años");
    expect(formatAntiguedad("Más de 20 años", "en")).toBe("Over 20 years old");
    expect(formatAntiguedad("12 Byears", "es")).toBe("12 años");
    expect(formatAntiguedad("Byears", "en")).toBe("Age not specified");
    expect(formatAntiguedad("Para estrenar", "en")).toBe("New construction");
    expect(formatAntiguedad(1, "en")).toBe("1 year old");
  });
  it("ignores non-age noise", () => {
    expect(formatAntiguedad("Stratum 5", "es")).toBeNull();
    expect(formatAntiguedad("", "es")).toBeNull();
    expect(formatAntiguedad(null, "en")).toBeNull();
  });
});
