import { Link, useNavigate } from "@tanstack/react-router";
import { LogOut, ArrowLeft, Menu, X, ChevronDown } from "@/lib/icons";
import { useRef, useState } from "react";
import { createPortal } from "react-dom";
import { auth } from "@/lib/auth";
import { logout } from "@/hooks/useAuth";
import { useIsAgente } from "@/components/LockedField";
import { useLang, FlagCO, FlagUS } from "@/lib/i18n";
import { useIsMobile } from "@/hooks/use-mobile";
import { Wordmark } from "@/components/Wordmark";
import type { Neighborhood } from "@/lib/adapters";

export type MapTab = "buy" | "rent" | "sell" | "agent" | "simulator" | "comparador";

const BASE_TABS: { id: MapTab; label: string; route?: string }[] = [
  { id: "buy",        label: "Comprar" },
  { id: "rent",       label: "Arrendar" },
  { id: "sell",       label: "Vender / Arrendar", route: "/vender" },
  { id: "agent",      label: "Encuentra un agente", route: "/agentes" },
];

// Solo agentes/agencias ven estos — herramientas profesionales, no para el consumidor final.
const AGENTE_TABS: { id: MapTab; label: string; route?: string }[] = [
  { id: "simulator",  label: "Simular", route: "/simulador" },
  { id: "comparador", label: "Comparar", route: "/comparador" },
];

// Mismos links/hrefs que ComunidadNavbar (home) — <a> plano igual que allá,
// no <Link> tipado (evita fricción con rutas dinámicas $barrio_slug).
const SITE_LINKS: { label: string; href: string }[] = [
  { label: "HOME",        href: "/" },
  { label: "EVENTOS",     href: "/eventos/todos" },
  { label: "NEGOCIOS",    href: "/local-business/todos" },
  { label: "REAL ESTATE", href: "/real-estate" },
  { label: "BLOG",        href: "/blog" },
];

type MapNavbarProps = {
  activeTab: MapTab;
  onTabChange: (tab: MapTab) => void;
  mlsBarrio?: Neighborhood | null;
  mlsTotal?: number;
  onBack?: () => void;
};

const C = {
  paper:    "#FAF8F3",
  tealDeep: "#0A5C36",
  teal:     "#0F8A4F",
  muted:    "#5B5F5C",
  border:   "#E5E0D5",
  ink:      "#111418",
  coral:    "#CE1126",
  amarillo: "#FCD116",
  serif:    "'Fraunces', Georgia, serif" as const,
};

// Chrome del navbar en sí (barra + menú móvil) — mismo ink oscuro que
// ComunidadNavbar para que el header se vea igual en todas las páginas.
// Los dropdowns flotantes de escritorio (herramientas/cuenta) se quedan
// claros — son popovers sobre el mapa, no "el header".
const NAV = {
  bg:     "#111418",
  border: "rgba(255,255,255,0.08)",
  text:   "rgba(255,255,255,0.85)",
  muted:  "rgba(255,255,255,0.55)",
};

export function MapNavbar({ activeTab, onTabChange, mlsBarrio, mlsTotal, onBack }: MapNavbarProps) {
  const navigate = useNavigate();
  const { lang, toggle } = useLang();
  const isMobile = useIsMobile();
  const isAgente = useIsAgente();
  const [menuOpen, setMenuOpen] = useState(false);
  const [accountOpen, setAccountOpen] = useState(false);
  const accountBtnRef = useRef<HTMLButtonElement>(null);
  const [accountPos, setAccountPos] = useState({ top: 0, right: 0 });
  const [toolsOpen, setToolsOpen] = useState(false);
  const toolsBtnRef = useRef<HTMLButtonElement>(null);
  const [toolsPos, setToolsPos] = useState({ top: 0, left: 0 });
  const user = typeof window !== "undefined" ? auth.get() : null;
  const TABS = isAgente ? [...BASE_TABS, ...AGENTE_TABS] : BASE_TABS;
  const activeTool = AGENTE_TABS.find((t) => t.id === activeTab);

  const toggleTools = () => {
    if (!toolsOpen && toolsBtnRef.current) {
      const r = toolsBtnRef.current.getBoundingClientRect();
      setToolsPos({ top: r.bottom + 4, left: r.left });
    }
    setToolsOpen((o) => !o);
  };

  const toggleAccount = () => {
    if (!accountOpen && accountBtnRef.current) {
      const r = accountBtnRef.current.getBoundingClientRect();
      setAccountPos({ top: r.bottom + 6, right: window.innerWidth - r.right });
    }
    setAccountOpen((o) => !o);
  };

  // ── Mobile: logo + Comprar/Arrendar segmented + hamburger (rest in a menu) ──
  if (isMobile) {
    const menuTabs = TABS.filter((t) => t.route);
    const itemStyle: React.CSSProperties = {
      background: "none", border: "none", textAlign: "left", padding: "12px 16px",
      fontSize: 14, fontWeight: 600, color: NAV.text, cursor: "pointer",
      borderBottom: `1px solid ${NAV.border}`, textDecoration: "none", display: "block",
    };
    return (
      <header
        style={{
          position: "absolute", inset: "0 0 auto 0", zIndex: 40,
          background: NAV.bg, borderBottom: `1px solid ${NAV.border}`,
          display: "flex", alignItems: "center", padding: "0 12px", height: 52, gap: 8,
        }}
      >
        {/* Comprar / Arrendar — the two tabs that stay on /map */}
        <div data-tour="tabs-comprar-arrendar" style={{ display: "flex", border: `1px solid ${NAV.border}`, borderRadius: 999, overflow: "hidden", flexShrink: 0 }}>
          {(["buy", "rent"] as const).map((id) => {
            const active = activeTab === id;
            return (
              <button
                key={id}
                onClick={() => { if (activeTab === "simulator" || activeTab === "comparador") navigate({ to: "/map" }); else onTabChange(id); }}
                style={{
                  border: "none", background: active ? C.teal : "transparent",
                  color: active ? "#fff" : NAV.muted, padding: "6px 16px",
                  fontSize: 13, fontWeight: 700, cursor: "pointer",
                }}
              >
                {id === "buy" ? "Comprar" : "Arrendar"}
              </button>
            );
          })}
        </div>

        <div style={{ flex: 1 }} />

        <button
          onClick={() => setMenuOpen((o) => !o)}
          aria-label="Menú"
          style={{
            background: "none", border: `1px solid ${NAV.border}`, borderRadius: 8,
            width: 36, height: 34, display: "flex", alignItems: "center", justifyContent: "center",
            color: NAV.text, cursor: "pointer", flexShrink: 0,
          }}
        >
          {menuOpen ? <X size={18} /> : <Menu size={18} />}
        </button>

        {menuOpen && (
          <>
            <div onClick={() => setMenuOpen(false)} style={{ position: "fixed", inset: 0, zIndex: 49 }} />
            <div
              style={{
                position: "fixed", top: 56, right: 12, zIndex: 50,
                background: NAV.bg, border: `1px solid ${NAV.border}`, borderRadius: 12,
                boxShadow: "0 8px 28px rgba(0,0,0,0.18)", minWidth: 200, overflow: "hidden",
                display: "flex", flexDirection: "column",
              }}
            >
              {SITE_LINKS.map((link) => (
                <a key={link.href} href={link.href} style={itemStyle}>
                  {link.label}
                </a>
              ))}

              {menuTabs.map((tab) => (
                <button key={tab.id} onClick={() => { setMenuOpen(false); navigate({ to: tab.route as any }); }} style={itemStyle}>
                  {tab.label}
                </button>
              ))}

              <div style={{ display: "flex", gap: 8, padding: "12px 16px", borderBottom: `1px solid ${NAV.border}`, alignItems: "center" }}>
                <span style={{ fontSize: 13, color: NAV.muted, fontWeight: 600 }}>Idioma</span>
                <div style={{ display: "flex", gap: 6, marginLeft: "auto" }}>
                  {(["es", "en"] as const).map((l) => (
                    <button
                      key={l}
                      onClick={() => lang !== l && toggle()}
                      title={l === "es" ? "Español (Colombia)" : "English (USA)"}
                      style={{
                        border: `1.5px solid ${lang === l ? C.teal : "rgba(255,255,255,0.25)"}`,
                        background: lang === l ? "rgba(29,158,117,0.2)" : "rgba(255,255,255,0.05)",
                        borderRadius: 999,
                        padding: "3px 8px",
                        cursor: lang === l ? "default" : "pointer",
                        display: "flex", alignItems: "center",
                      }}
                    >
                      {l === "es" ? <FlagCO /> : <FlagUS />}
                    </button>
                  ))}
                </div>
              </div>

              {user ? (
                <>
                  <Link to="/perfil" onClick={() => setMenuOpen(false)} style={itemStyle}>Mi perfil</Link>
                  <button
                    onClick={() => { logout(); navigate({ to: "/login" }); }}
                    style={{ ...itemStyle, color: C.coral, display: "flex", alignItems: "center", gap: 8 }}
                  >
                    <LogOut size={15} /> Salir
                  </button>
                </>
              ) : (
                <>
                  <Link to="/login" onClick={() => setMenuOpen(false)} style={itemStyle}>Ingresar</Link>
                  <Link to="/register" onClick={() => { localStorage.setItem("registro_origen", "mls"); setMenuOpen(false); }} style={{ ...itemStyle, color: C.teal, fontWeight: 700, borderBottom: "none" }}>
                    Registrarse
                  </Link>
                </>
              )}
            </div>
          </>
        )}
      </header>
    );
  }

  const renderTab = (tab: (typeof BASE_TABS)[number]) => {
    const active = activeTab === tab.id;

    if (tab.route) {
      return (
        <button
          key={tab.id}
          onClick={() => navigate({ to: tab.route as any })}
          style={{
            background: "none", border: "none", padding: "0 11px",
            borderBottom: active ? `2px solid ${C.teal}` : "2px solid transparent",
            color: active ? C.amarillo : NAV.text,
            fontWeight: active ? 700 : 500,
            fontSize: 13, cursor: "pointer",
            transition: "color 0.15s",
            letterSpacing: "0.1px",
            flexShrink: 0,
            display: "flex", alignItems: "center", gap: 4,
          }}
          onMouseEnter={(e) => { if (!active) e.currentTarget.style.color = "#fff"; }}
          onMouseLeave={(e) => { if (!active) e.currentTarget.style.color = active ? C.amarillo : NAV.text; }}
        >
          {tab.label}
        </button>
      );
    }

    return (
      <button
        key={tab.id}
        onClick={() => {
          if (activeTab === "simulator" || activeTab === "comparador") {
            navigate({ to: "/map" });
          } else {
            onTabChange(tab.id);
          }
        }}
        style={{
          background: "none", border: "none", padding: "0 11px",
          borderBottom: active ? `2px solid ${C.teal}` : "2px solid transparent",
          color: active ? C.amarillo : NAV.text,
          fontWeight: active ? 700 : 500,
          fontSize: 13, cursor: "pointer",
          transition: "color 0.15s",
          letterSpacing: "0.1px",
          flexShrink: 0,
        }}
        onMouseEnter={(e) => { if (!active) e.currentTarget.style.color = "#fff"; }}
        onMouseLeave={(e) => { if (!active) e.currentTarget.style.color = active ? C.amarillo : NAV.text; }}
      >
        {tab.label}
      </button>
    );
  };

  return (
    <header
      style={{
        position: "absolute", inset: "0 0 auto 0", zIndex: 40,
        background: NAV.bg,
        borderBottom: `1px solid ${NAV.border}`,
        display: "grid", gridTemplateColumns: "1fr auto 1fr", alignItems: "stretch",
        columnGap: 16,
        padding: "0 16px", height: 52,
      }}
    >
      {/* Left: tabs + MLS back breadcrumb */}
      <div style={{ display: "flex", alignItems: "stretch", gap: 12, minWidth: 0, overflow: "hidden" }}>
      <nav className="map-nav-tabs" style={{ display: "flex", alignItems: "stretch", minWidth: 0, overflowX: "auto", overflowY: "hidden" }}>
        {SITE_LINKS.map((link) => (
          <a
            key={link.href}
            href={link.href}
            style={{
              display: "flex", alignItems: "center",
              padding: "0 11px", borderBottom: "2px solid transparent",
              color: NAV.text, fontWeight: 500, fontSize: 13,
              textDecoration: "none", letterSpacing: "0.1px", flexShrink: 0,
            }}
            onMouseEnter={(e) => { e.currentTarget.style.color = "#fff"; }}
            onMouseLeave={(e) => { e.currentTarget.style.color = NAV.text; }}
          >
            {link.label}
          </a>
        ))}
        <div style={{ width: 1, alignSelf: "center", height: 20, background: NAV.border, margin: "0 6px", flexShrink: 0 }} />
        <div data-tour="tabs-comprar-arrendar" style={{ display: "flex", alignItems: "stretch" }}>
          {BASE_TABS.slice(0, 2).map(renderTab)}
        </div>
        {BASE_TABS.slice(2).map(renderTab)}

        {isAgente && (
          <button
            ref={toolsBtnRef}
            onClick={toggleTools}
            style={{
              background: "none", border: "none", padding: "0 11px",
              borderBottom: activeTool ? `2px solid ${C.teal}` : "2px solid transparent",
              color: activeTool ? C.amarillo : NAV.text,
              fontWeight: activeTool ? 700 : 500,
              fontSize: 13, cursor: "pointer",
              letterSpacing: "0.1px",
              flexShrink: 0,
              display: "flex", alignItems: "center", gap: 4,
            }}
          >
            {activeTool ? activeTool.label : "Herramientas"}
            <ChevronDown size={13} style={{ transform: toolsOpen ? "rotate(180deg)" : undefined, transition: "transform 0.15s" }} />
          </button>
        )}
      </nav>

      {isAgente && toolsOpen && createPortal(
        <>
          <div onClick={() => setToolsOpen(false)} style={{ position: "fixed", inset: 0, zIndex: 9998 }} />
          <div
            style={{
              position: "fixed", top: toolsPos.top, left: toolsPos.left, zIndex: 9999,
              background: C.paper, border: `1px solid ${C.border}`, borderRadius: 8,
              boxShadow: "0 8px 24px rgba(0,0,0,0.15)", minWidth: 140, overflow: "hidden",
            }}
          >
            {AGENTE_TABS.map((t) => (
              <button
                key={t.id}
                onClick={() => { setToolsOpen(false); navigate({ to: t.route as any }); }}
                style={{
                  display: "block", width: "100%", textAlign: "left",
                  background: activeTab === t.id ? "rgba(29,158,117,0.1)" : "none",
                  border: "none", padding: "9px 14px", fontSize: 13,
                  fontWeight: activeTab === t.id ? 700 : 500,
                  color: activeTab === t.id ? C.tealDeep : C.ink,
                  cursor: "pointer",
                }}
              >
                {t.label}
              </button>
            ))}
          </div>
        </>,
        document.body
      )}

      {/* MLS back breadcrumb */}
      {mlsBarrio && (
        <button
          onClick={onBack}
          style={{
            display: "flex", alignItems: "center", gap: 6,
            background: "none", border: `1px solid ${NAV.border}`,
            borderRadius: 8, padding: "4px 12px", alignSelf: "center",
            color: NAV.text, fontSize: 12, fontWeight: 600,
            cursor: "pointer", flexShrink: 0,
          }}
        >
          <ArrowLeft size={13} />
          <span data-i18n-skip>{mlsBarrio.nombre}</span>
          {mlsTotal != null && mlsTotal > 0 && (
            <span style={{
              background: C.teal, color: "#fff",
              borderRadius: 999, padding: "1px 7px",
              fontSize: 10, fontWeight: 700,
            }}>
              {mlsTotal}
            </span>
          )}
        </button>
      )}
      </div>

      {/* Center: Logo */}
      <Link
        to="/"
        style={{
          textDecoration: "none", display: "flex", alignItems: "center",
          justifySelf: "center", flexShrink: 0,
        }}
      >
        <span data-i18n-skip style={{ fontFamily: C.serif, fontWeight: 900, fontSize: "1.05rem", color: "#fff", letterSpacing: "-0.5px" }}>
          <Wordmark teal={C.teal} amarillo={C.amarillo} />
        </span>
      </Link>

      {/* Right controls */}
      <div style={{ display: "flex", alignItems: "center", gap: 10, justifySelf: "end", flexShrink: 0 }}>
        {user ? (
          <div style={{ position: "relative" }}>
            <button
              ref={accountBtnRef}
              onClick={toggleAccount}
              style={{
                background: "none", border: "none", padding: "2px 4px 2px 2px", borderRadius: 999,
                cursor: "pointer", display: "flex", alignItems: "center", gap: 7,
              }}
            >
              <span style={{
                fontSize: 12, color: NAV.text, fontWeight: 600,
                maxWidth: 90, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
              }}>
                {user.name}
              </span>
              <ChevronDown size={13} color={NAV.muted} style={{ transform: accountOpen ? "rotate(180deg)" : undefined, transition: "transform 0.15s" }} />
            </button>

            {accountOpen && createPortal(
              <>
                <div onClick={() => setAccountOpen(false)} style={{ position: "fixed", inset: 0, zIndex: 9998 }} />
                <div
                  style={{
                    position: "fixed", top: accountPos.top, right: accountPos.right, zIndex: 9999,
                    background: C.paper, border: `1px solid ${C.border}`, borderRadius: 10,
                    boxShadow: "0 8px 24px rgba(0,0,0,0.15)", minWidth: 200, overflow: "hidden",
                  }}
                >
                  <div style={{ padding: "10px 14px", borderBottom: `1px solid ${C.border}` }}>
                    <div style={{ fontSize: 13, fontWeight: 700, color: C.ink, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{user.name}</div>
                    <div style={{ fontSize: 11, color: C.muted, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{user.email}</div>
                  </div>

                  <Link to="/perfil" onClick={() => setAccountOpen(false)} style={accountItemStyle}>Mi perfil</Link>
                  <Link to="/perfil" search={{ tab: "favoritos" }} onClick={() => setAccountOpen(false)} style={accountItemStyle}>Favoritos</Link>
                  <Link to="/mis-propiedades" onClick={() => setAccountOpen(false)} style={accountItemStyle}>Mis propiedades</Link>
                  {isAgente && (
                    <Link to="/realtor/dashboard" onClick={() => setAccountOpen(false)} style={accountItemStyle}>Panel de agente</Link>
                  )}
                  <Link to="/planes" search={{ audiencia: isAgente ? "agente" : undefined }} onClick={() => setAccountOpen(false)} style={accountItemStyle}>Mi plan</Link>

                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "9px 14px", borderTop: `1px solid ${C.border}` }}>
                    <span style={{ fontSize: 12, color: C.muted, fontWeight: 600 }}>Idioma</span>
                    <div style={{ display: "flex", gap: 4 }}>
                      {(["es", "en"] as const).map((l) => (
                        <button
                          key={l}
                          onClick={() => lang !== l && toggle()}
                          title={l === "es" ? "Español (Colombia)" : "English (USA)"}
                          style={{
                            border: `1.5px solid ${lang === l ? C.teal : "#C9C4B8"}`,
                            background: lang === l ? "rgba(29,158,117,0.14)" : "rgba(0,0,0,0.05)",
                            borderRadius: 999, padding: "3px 8px",
                            cursor: lang === l ? "default" : "pointer", display: "flex", alignItems: "center",
                          }}
                        >
                          {l === "es" ? <FlagCO /> : <FlagUS />}
                        </button>
                      ))}
                    </div>
                  </div>

                  <button
                    onClick={() => { setAccountOpen(false); logout(); navigate({ to: "/login" }); }}
                    style={{ ...accountItemStyle, width: "100%", textAlign: "left", color: C.coral, display: "flex", alignItems: "center", gap: 8, borderTop: `1px solid ${C.border}` }}
                  >
                    <LogOut size={14} /> Cerrar sesión
                  </button>
                </div>
              </>,
              document.body
            )}
          </div>
        ) : (
          <>
            {/* Language */}
            <div style={{ display: "flex", gap: 4 }}>
              {(["es", "en"] as const).map((l) => (
                <button
                  key={l}
                  onClick={() => lang !== l && toggle()}
                  title={l === "es" ? "Español (Colombia)" : "English (USA)"}
                  style={{
                    border: `1.5px solid ${lang === l ? C.teal : "rgba(255,255,255,0.25)"}`,
                    background: lang === l ? "rgba(29,158,117,0.2)" : "rgba(255,255,255,0.05)",
                    borderRadius: 999,
                    padding: "3px 8px",
                    cursor: lang === l ? "default" : "pointer",
                    display: "flex", alignItems: "center",
                  }}
                >
                  {l === "es" ? <FlagCO /> : <FlagUS />}
                </button>
              ))}
            </div>

            <Link
              to="/login"
              style={{
                fontSize: 12, color: NAV.text, fontWeight: 600,
                textDecoration: "none", padding: "4px 8px",
              }}
            >
              Ingresar
            </Link>
            <Link
              to="/register"
              onClick={() => localStorage.setItem("registro_origen", "mls")}
              style={{
                fontSize: 12, fontWeight: 700, color: "#fff",
                background: C.teal, borderRadius: 6, padding: "4px 12px",
                textDecoration: "none",
              }}
            >
              Registrarse
            </Link>
          </>
        )}
      </div>
    </header>
  );
}

const accountItemStyle: React.CSSProperties = {
  display: "block", padding: "9px 14px", fontSize: 13, fontWeight: 500,
  color: C.ink, textDecoration: "none", cursor: "pointer",
  background: "none", border: "none",
};
