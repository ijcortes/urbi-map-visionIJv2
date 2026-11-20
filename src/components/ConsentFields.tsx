/**
 * Consentimiento de tratamiento de datos (Ley 1581/2012, Decreto 1377/2013).
 * Fuente única del texto legal — reutilizado en /register y /suscribirse para que
 * el copy no derive entre las dos superficies de alta.
 *
 * ponytail: el texto vinculante definitivo lo define el negocio/abogado en
 * /politica-privacidad. Aquí va el checkbox obligatorio + el enlace; el backend
 * sella la versión aceptada (api/legal.py HABEAS_DATA_VERSION).
 */
import { useT } from "@/lib/i18n";

export function ConsentFields({
  habeasData,
  setHabeasData,
  consentWhatsapp,
  setConsentWhatsapp,
}: {
  habeasData: boolean;
  setHabeasData: (v: boolean) => void;
  consentWhatsapp: boolean;
  setConsentWhatsapp: (v: boolean) => void;
}) {
  const t = useT();
  const row: React.CSSProperties = {
    display: "flex", alignItems: "flex-start", gap: 10,
    fontFamily: "'Inter', system-ui, sans-serif", fontSize: 13,
    color: "#5B5F5C", lineHeight: 1.45, cursor: "pointer",
  };
  const box: React.CSSProperties = { marginTop: 2, flexShrink: 0, width: 16, height: 16, cursor: "pointer" };

  return (
    // data-i18n-skip: evita que el DOM translator (diccionario palabra-por-palabra)
    // lo deje en Spanglish ("mis data personales", "optional"). La traducción EN/ES
    // la da useT() con la frase completa, limpia.
    <div data-i18n-skip style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <label style={row}>
        <input
          type="checkbox"
          checked={habeasData}
          onChange={(e) => setHabeasData(e.target.checked)}
          style={box}
        />
        <span>
          {t("Autorizo el tratamiento de mis datos personales conforme a la ", "I authorize the processing of my personal data in accordance with the ")}
          <a href="/politica-privacidad" target="_blank" rel="noopener noreferrer"
             style={{ color: "#0F8A4F", fontWeight: 700 }}>
            {t("Política de Tratamiento de Datos", "Data Processing Policy")}
          </a>
          {t(" (Ley 1581 de 2012). ", " (Law 1581 of 2012). ")}
          <span style={{ color: "#CE1126" }}>*</span>
        </span>
      </label>
      <label style={row}>
        <input
          type="checkbox"
          checked={consentWhatsapp}
          onChange={(e) => setConsentWhatsapp(e.target.checked)}
          style={box}
        />
        <span>{t("Quiero recibir ofertas y novedades por WhatsApp.", "I want to receive offers and news via WhatsApp.")}</span>
      </label>
    </div>
  );
}
