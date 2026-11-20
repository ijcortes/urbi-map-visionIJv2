import type { CSSProperties } from "react"
// Wordmark "Medellín Social." — el punto de la i de "Social" es un pin de
// mapa diminuto en vez de un punto genérico (producto de mapa, no un blog).
// Tamaño sigue el font-size heredado del contenedor (unidades em), un solo
// componente para los 3 sitios que repetían este wordmark (MapNavbar,
// ComunidadNavbar x2).
// pinTop: offset vertical del pin sobre la "i". El valor visual cambia según el
// contexto (line-height) donde vive el wordmark, por eso el veil de carga lo
// sube por su cuenta (pinTop propio) y los logos usan el default. Van separados.
// "Social" va relleno con la bandera de Colombia (amarillo arriba, azul, rojo
// abajo — proporción 2:1:1 sobre la altura de la letra), recortado al texto.
// Los cortes están medidos sobre Fraunces 900: amarillo hasta la mitad de la
// altura de las minúsculas, rojo desde el tercio inferior. flag={false}
// vuelve al "Social" verde plano.
const FLAG_FILL = "linear-gradient(180deg, #E0A800 0 SPLIT1, #003893 SPLIT1 SPLIT2, #CE1126 SPLIT2 100%)"
  .replace(/SPLIT1/g, "49.6%").replace(/SPLIT2/g, "68.8%")

function flagText(extra?: CSSProperties): CSSProperties {
  return {
    backgroundImage: FLAG_FILL,
    WebkitBackgroundClip: "text",
    backgroundClip: "text",
    WebkitTextFillColor: "transparent",
    color: "transparent",
    textShadow: "none",
    ...extra,
  }
}

export function Wordmark({ teal = "#0F8A4F", coral = "#CE1126", paper = "#FAF8F3", pinTop = "0.1em", flag = true }: {
  teal?: string
  coral?: string
  amarillo?: string
  paper?: string
  pinTop?: string
  flag?: boolean
}) {
  // "i" normal con su punto RECORTADO (clipPath) — el pin coral es el punto.
  // No usar ı U+0131: en iOS cae al fallback (Georgia) y desentona. El clip es
  // relativo al box propio (lineHeight:1), igual en los 3 contextos.
  const pinDot = (
    <svg
      viewBox="0 0 20 20"
      overflow="visible"
      style={{ width: "0.28em", height: "0.28em", display: "inline-block", position: "absolute", left: "50%", top: pinTop, transform: "translateX(-50%)", fontSize: "inherit" }}
      aria-hidden="true"
    >
      <path
        d="M10 1 C6 1 3.5 3.5 3.5 7 C3.5 11.5 10 18 10 18 C10 18 16.5 11.5 16.5 7 C16.5 3.5 13.5 1 10 1 Z"
        fill={coral}
      />
      <circle cx="10" cy="7" r="2.2" fill={paper} />
    </svg>
  )
  // Cada tramo lleva su propio fondo recortado: la "i" con clipPath no hereda
  // el background-clip:text del padre. Todos con lineHeight 1 → mismas franjas.
  const seg = (txt: string) => (
    <span style={flag ? flagText({ display: "inline-block", lineHeight: "1" }) : { display: "inline-block", lineHeight: "1" }}>{txt}</span>
  )
  const i = (
    <span data-i18n-skip style={{ position: "relative", display: "inline-block", lineHeight: "1", overflow: "visible" }}>
      <span style={flag ? flagText({ display: "inline-block", clipPath: "inset(0.42em 0 0 0)" }) : { display: "inline-block", clipPath: "inset(0.42em 0 0 0)" }}>i</span>{pinDot}
    </span>
  )
  // Los tramos partidos ("Soc" + "i" + "al") se leerían sueltos en un lector
  // de pantalla: el conjunto se anuncia como un solo nombre.
  return (
    <span data-i18n-skip role="img" aria-label="Medellín Social" style={{ whiteSpace: "nowrap" }}>
      <span aria-hidden="true">
        Medellín{" "}
        <span style={{ color: teal }}>
          {seg("Soc")}{i}{seg("al")}
        </span>
      </span>
    </span>
  )
}

// Insignia apilada (logo 05) — plaquita coral con "M" chico en ámbar arriba y
// "S" grande en paper abajo. Un solo componente, tamaño por prop, para que se
// vea igual en el header móvil de /map y en el círculo de cuenta.
export function BrandBadge({ size = 32, coral = "#CE1126", amarillo = "#E0A800", paper = "#FAF8F3" }: {
  size?: number
  coral?: string
  amarillo?: string
  paper?: string
}) {
  return (
    <div
      style={{
        width: size, height: size, borderRadius: size * 0.3, flexShrink: 0,
        background: coral, display: "flex", flexDirection: "column",
        alignItems: "center", justifyContent: "center", overflow: "hidden",
      }}
    >
      <span style={{ fontSize: size * 0.2, fontWeight: 700, letterSpacing: "0.05em", color: amarillo, lineHeight: 1 }}>
        M
      </span>
      <span style={{ fontFamily: "Georgia, serif", fontSize: size * 0.52, fontWeight: 900, color: paper, lineHeight: 1 }}>
        S
      </span>
    </div>
  )
}
