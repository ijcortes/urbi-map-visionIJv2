import { describe, it, expect, vi } from "vitest";
import { translateString } from "./i18n";

// Cobertura EN de los textos que salían en español (filtros, navbar, popups).
describe("translateString — nuevas entradas de traducción", () => {
  const cases: [string, string][] = [
    ["Otros municipios", "Other municipalities"],
    ["Toda la comuna", "Entire comuna"],
    ["Estado del inmueble", "Property condition"],
    ["Piso mínimo", "Minimum floor"],
    ["Menos filtros", "Fewer filters"],
    ["Usado", "Used"],
    ["Precio / mes", "Price / mo"],
    ["+30 días", "+30 days"],
    ["Mi perfil", "My profile"],
    ["Panel de agente", "Agent dashboard"],
    ["Ver en Metrocuadrado →", "View on Metrocuadrado →"],
    ["Espacio público (parque, plaza)", "Public space (park, plaza)"],
    ["Te contactaremos pronto para confirmar.", "We'll contact you soon to confirm."],
    ["Para invertir", "To invest"],
    ["Menos de $200M", "Under $200M"],
    ["Más de $1.000M", "Over $1.000M"],
    ["De contado", "Cash"],
    ["En trámite", "In process"],
    ["Aún no", "Not yet"],
    ["En comparación", "In comparison"],
    ["Foto del inmueble", "Property photo"],
    ["Continuar →", "Continue →"],
    ["Ver comunidad →", "View community →"],
    ["Conectar con tu comunidad", "Connect with your community"],
    ["Perfil guardado. Explorando el mapa…", "Profile saved. Opening the map…"],
    ["Publica y conecta con compradores e inversores", "List and connect with buyers and investors"],
  ];
  for (const [es, en] of cases) {
    it(`"${es}" → "${en}"`, () => expect(translateString(es)).toBe(en));
  }

  // "Crédito aprobado" debe ganar a "Crédito" (frase larga primero, sin Spanglish).
  it("no produce Spanglish en 'Crédito aprobado'", () => {
    expect(translateString("Crédito aprobado")).toBe("Pre-approved");
    expect(translateString("Crédito")).toBe("Financing");
  });

  // Word-boundary: no debe mutilar una palabra que contiene una entrada corta.
  it("respeta límites de palabra", () => {
    expect(translateString("Usadora")).toBe("Usadora");
  });
});

// ── Regression suite (audit I1-I21) ─────────────────────────────────────────
import { __i18nInternals } from "./i18n";
import { PHRASES } from "./i18n-phrases";

describe("case-insensitive matching with case restore (I1/I2/I7)", () => {
  const cases: [string, string][] = [
    ["metros cuadrados", "square meters"],
    ["1000 metros cuadrados", "1000 square meters"],
    ["Metros cuadrados", "Square meters"],
    ["hasta 2.5K", "up to 2.5K"],
    ["Hasta $2.5M", "Up to $2.5M"],
    ["desde $400K", "from $400K"],
    ["Desde", "From"],
    ["Precio", "Price"],
    ["Precio mínimo", "Minimum price"],
    ["precio máximo", "maximum price"],
    ["Área mínima", "Minimum area"],
    ["Hace 3 días", "3 days ago"],
    ["Hace 1 mes", "1 month ago"],
  ];
  for (const [es, en] of cases) it(`"${es}" -> "${en}"`, () => expect(translateString(es)).toBe(en));
  it("upper-case input keeps its casing", () => expect(translateString("HASTA")).toBe("UP TO"));
  it("does not translate the preposition 'bajo' via the BAJO label", () => {
    expect(translateString("5% bajo la mediana")).toBe("5% below the median");
  });
});

describe("digit-adjacent units (I4)", () => {
  it("3hab / 2baños", () => {
    expect(translateString("3hab")).toBe("3bd");
    expect(translateString("2baños")).toBe("2baths");
    expect(translateString("4+ hab.")).toMatch(/^4\+ bd/);
  });
  it("still respects letter boundaries", () => {
    expect(translateString("BUENOS AIRES")).toBe("BUENOS AIRES");
    expect(translateString("Usadora")).toBe("Usadora");
  });
});

describe("PROTECT no longer blocks real labels (I5)", () => {
  const cases: [string, string][] = [
    ["MUY SEGURO", "VERY SAFE"], ["ALTA", "HIGH"], ["MEDIA", "MEDIUM"], ["BAJA", "LOW"],
    ["SALUDABLE", "HEALTHY"], ["PRECAUCIÓN", "CAUTION"], ["Seguridad", "Safety"],
    ["Valorización", "Appreciation"], ["Salud financiera", "Financial health"],
    ["Sin remates activos ✅", "No active auctions ✅"],
  ];
  for (const [es, en] of cases) it(`${es} -> ${en}`, () => expect(translateString(es)).toBe(en));
  it("brand and place names stay", () => {
    expect(translateString("Medellín")).toBe("Medellín");
    expect(translateString("El Poblado")).toBe("El Poblado");
  });
});

describe("Spanglish fixes (I6/I15)", () => {
  it("Local comercial", () => expect(translateString("Local comercial")).toBe("Commercial space"));
  it("Quitar de comparación", () => expect(translateString("Quitar de comparación")).toBe("Remove from comparison"));
  it("Antigüedad no especificada", () => expect(translateString("Antigüedad no especificada")).toBe("Age not specified"));
  it("status labels", () => {
    expect(translateString("Disponible")).toBe("Available");
    expect(translateString("Reservado")).toBe("Reserved");
    expect(translateString("Vendido")).toBe("Sold");
  });
  it("toasts", () => {
    expect(translateString("Error al crear la alerta")).toBe("Error creating the alert");
    expect(translateString("No pudimos registrar la visita. Intenta de nuevo.")).toBe("We couldn't register the visit. Try again.");
  });
});

describe("dictionary hygiene (I18)", () => {
  it("has no duplicate keys", () => {
    const seen = new Set<string>();
    const dups: string[] = [];
    for (const [es] of PHRASES) {
      if (seen.has(es)) dups.push(es);
      seen.add(es);
    }
    expect(dups).toEqual([]);
  });
  it("resolved conflicting values", () => {
    const d = new Map(PHRASES);
    expect(d.get("Cocina integral")).toBe("Full kitchen");
  });
});

describe("DOM attribute cache (I8)", () => {
  it("a fresh React-written attribute wins over the stale cached original", () => {
    document.body.innerHTML = `<input placeholder="Mínimo">`;
    const el = document.querySelector("input")!;
    __i18nInternals.translateNode(document.body);
    expect(el.getAttribute("placeholder")).toBe("Minimum");
    // React re-renders with a new Spanish value
    el.setAttribute("placeholder", "Máximo");
    __i18nInternals.translateNode(el);
    expect(el.getAttribute("placeholder")).toBe("Maximum");
    __i18nInternals.restoreNode(document.body);
    expect(el.getAttribute("placeholder")).toBe("Máximo");
  });
  it("restore does not clobber a fresh value written while in EN", () => {
    document.body.innerHTML = `<button title="Cerrar">x</button>`;
    const el = document.querySelector("button")!;
    __i18nInternals.translateNode(document.body);
    el.setAttribute("title", "Compartir fresh");
    __i18nInternals.restoreNode(document.body);
    expect(el.getAttribute("title")).toBe("Compartir fresh");
  });
});

describe("language persistence (I9)", () => {
  it("reads localStorage synchronously and validates", () => {
    localStorage.setItem("medellin-social.lang", "en");
    expect(__i18nInternals.readStoredLang()).toBe("en");
    // Valor inválido → idioma del navegador (jsdom: en-US).
    localStorage.setItem("medellin-social.lang", "fr");
    expect(__i18nInternals.readStoredLang()).toBe("en");
    localStorage.removeItem("medellin-social.lang");
    document.cookie = "medellin-social.lang=en; path=/";
    expect(__i18nInternals.readStoredLang()).toBe("en");
    document.cookie = "medellin-social.lang=; path=/; max-age=0";
  });

  it("sin idioma guardado usa el del navegador", () => {
    localStorage.removeItem("medellin-social.lang");
    const spy = vi.spyOn(navigator, "languages", "get");
    spy.mockReturnValue(["es-CO", "en"]);
    expect(__i18nInternals.readStoredLang()).toBe("es");
    spy.mockReturnValue(["en-US"]);
    expect(__i18nInternals.readStoredLang()).toBe("en");
    spy.mockReturnValue(["pt-BR"]);
    expect(__i18nInternals.readStoredLang()).toBe("en");
    spy.mockRestore();
  });
});


describe("useT + diccionario", () => {
  it("no re-traduce lo que useT ya devolvió en inglés", async () => {
    const { renderHook } = await import("@testing-library/react");
    const { persistLang, useT: useTHook, LanguageProvider } = await import("./i18n");
    persistLang("en");
    const { result } = renderHook(() => useTHook(), { wrapper: LanguageProvider });
    const en = result.current("Todo lo local, en un solo lugar.", "Everything local, in one place.");
    expect(translateString(en)).toBe(en);
    persistLang("es");
  });
});
