import { describe, it, expect } from "vitest";
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
