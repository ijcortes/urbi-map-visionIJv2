// Property age arrives as free text in several shapes depending on the portal
// ("Entre 5 y 10 años", "Más de 20 años", "12 Byears", "Para estrenar", ...).
// Parse it once into a small enum-like value and render it per language, instead
// of regex-rewriting English tokens into Spanish and letting the DOM dictionary
// translate them back.
export type Antiguedad =
  | { kind: "nuevo" }
  | { kind: "anios"; n: number }
  | { kind: "rango"; min: number; max: number }
  | { kind: "mas_de"; n: number }
  | { kind: "menos_de"; n: number }
  | { kind: "desconocida" };

export function parseAntiguedad(raw: string | number | null | undefined): Antiguedad | null {
  if (raw == null || raw === "") return null;
  if (typeof raw === "number") return Number.isFinite(raw) && raw >= 0 ? { kind: "anios", n: Math.round(raw) } : null;
  const v = raw.trim().toLowerCase();
  // Portal noise seen in this field (stratum / operation labels) is not an age.
  if (/stratum|estrato|\bsale\b|\bventa\b|rental|arriendo/.test(v)) return null;
  if (/estrenar|nuevo|new|sobre planos/.test(v)) return { kind: "nuevo" };
  let m = v.match(/entre\s*(\d+)\s*(?:y|-|a)\s*(\d+)/);
  if (m) return { kind: "rango", min: +m[1], max: +m[2] };
  m = v.match(/(\d+)\s*(?:-|a)\s*(\d+)/);
  if (m) return { kind: "rango", min: +m[1], max: +m[2] };
  m = v.match(/(?:m[aá]s de|more than|over|\+)\s*(\d+)/);
  if (m) return { kind: "mas_de", n: +m[1] };
  m = v.match(/(?:menos de|less than|under)\s*(\d+)/);
  if (m) return { kind: "menos_de", n: +m[1] };
  m = v.match(/(\d+)/);
  if (m) return { kind: "anios", n: +m[1] };
  if (/byears?|no especificad|unknown/.test(v)) return { kind: "desconocida" };
  return null;
}

export function formatAntiguedad(raw: string | number | null | undefined, lang: "es" | "en"): string | null {
  const a = parseAntiguedad(raw);
  if (!a) return null;
  const en = lang === "en";
  switch (a.kind) {
    case "nuevo": return en ? "New construction" : "Para estrenar";
    case "anios": return en ? `${a.n} ${a.n === 1 ? "year" : "years"} old` : `${a.n} ${a.n === 1 ? "año" : "años"}`;
    case "rango": return en ? `${a.min}–${a.max} years old` : `Entre ${a.min} y ${a.max} años`;
    case "mas_de": return en ? `Over ${a.n} years old` : `Más de ${a.n} años`;
    case "menos_de": return en ? `Under ${a.n} years old` : `Menos de ${a.n} años`;
    case "desconocida": return en ? "Age not specified" : "Antigüedad no especificada";
  }
}
