import { Link, useNavigate } from "@tanstack/react-router";
import { ArrowLeft, LogOut } from "@/lib/icons";
import { auth } from "@/lib/auth";
import { logout } from "@/hooks/useAuth";
import { useLang, FlagCO, FlagUS } from "@/lib/i18n";
import type { Neighborhood } from "@/lib/adapters";
import { K as TOKENS } from "@/design/tokens";
import { Wordmark } from "@/components/Wordmark";

// Navbar sits on the dark map chrome, so lines and muted text are white tints.
const K = { ...TOKENS, line: 'rgba(255,255,255,0.12)', muted: 'rgba(255,255,255,0.65)' } as const;

type NavbarProps = {
  mlsBarrio?: Neighborhood | null;
  mlsTotal?: number;
  onBack?: () => void;
};

export function Navbar({ mlsBarrio, mlsTotal, onBack }: NavbarProps = {}) {
  const user    = typeof window !== "undefined" ? auth.get() : null;
  const navigate = useNavigate();
  const { lang, toggle } = useLang();

  const initials = (user?.name ?? "U")
    .split(/\s+/)
    .map((s) => s[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();

  const linkStyle: React.CSSProperties = {
    color: 'rgba(255,255,255,0.85)',
    fontSize: 13,
    fontWeight: 600,
    textDecoration: 'none',
    letterSpacing: '.6px',
    textTransform: 'uppercase',
    fontFamily: 'inherit',
  };

  return (
    <header style={{
      position: 'absolute', inset: '0 0 auto 0', zIndex: 30,
      background: K.ink,
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      padding: '0 24px', height: 52, gap: 16,
      borderBottom: `1px solid ${K.line}`,
    }}>
      {/* LOGO */}
      <Link to="/" style={{ textDecoration: 'none', flexShrink: 0 }}>
        <span style={{ fontFamily: K.serif, fontWeight: 900, fontSize: '1.15rem', color: '#fff', letterSpacing: '-0.5px' }}>
          <Wordmark />
        </span>
      </Link>

      {/* RIGHT */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 20, flexShrink: 0 }}>

        {/* MLS breadcrumb */}
        {mlsBarrio ? (
          <button
            onClick={onBack}
            style={{
              display: 'flex', alignItems: 'center', gap: 8,
              background: 'none', border: `1px solid ${K.line}`,
              borderRadius: 8, padding: '6px 14px',
              color: 'rgba(255,255,255,0.85)', fontSize: 13, fontWeight: 600,
              cursor: 'pointer', fontFamily: 'inherit',
            }}
          >
            <ArrowLeft size={14} />
            <span>{mlsBarrio.nombre}</span>
            {mlsTotal != null && mlsTotal > 0 && (
              <span style={{
                background: K.teal, color: '#fff',
                borderRadius: 999, padding: '1px 8px',
                fontSize: 11, fontWeight: 700,
              }}>
                {mlsTotal}
              </span>
            )}
          </button>
        ) : (
          <>
            <Link to="/simulador" style={linkStyle}>Simulador 💰</Link>
            <Link to="/comparador" style={linkStyle}>Comparador</Link>
          </>
        )}

        {/* Language pill */}
        <div style={{ display: 'flex', gap: 4 }}>
          {(['es', 'en'] as const).map(l => (
            <button
              key={l}
              onClick={() => lang !== l && toggle()}
              title={l === 'es' ? 'Español (Colombia)' : 'English (USA)'}
              aria-label={l === 'es' ? 'Español' : 'English'}
              aria-pressed={lang === l}
              data-testid={`lang-${l}`}
              style={{
                border: `1.5px solid ${lang === l ? K.amarillo : 'rgba(255,255,255,0.35)'}`,
                background: lang === l ? 'rgba(255,201,40,0.22)' : 'rgba(255,255,255,0.1)',
                borderRadius: 999,
                padding: '3px 8px',
                cursor: lang === l ? 'default' : 'pointer',
                display: 'flex', alignItems: 'center',
              }}
            >
              {l === 'es' ? <FlagCO /> : <FlagUS />}
            </button>
          ))}
        </div>

        {/* Avatar */}
        <Link to="/perfil" title="Perfil" style={{ textDecoration: 'none', display: 'flex', alignItems: 'center', gap: 8 }}>
          <div style={{
            width: 28, height: 28, borderRadius: '50%',
            background: `linear-gradient(135deg, ${K.teal}, #0A5C36)`,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 11, fontWeight: 800, color: '#fff', overflow: 'hidden', flexShrink: 0,
          }}>
            {user?.avatar
              ? <img src={user.avatar} alt="avatar" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
              : initials}
          </div>
          <span style={{ fontSize: 13, color: 'rgba(255,255,255,0.85)', fontWeight: 600, maxWidth: 110, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {user?.name ?? "Invitado"}
          </span>
        </Link>

        {/* Logout */}
        <button
          onClick={() => { logout(); navigate({ to: "/login" }); }}
          title="Salir"
          style={{
            background: 'none', border: 'none',
            color: 'rgba(255,255,255,0.55)', cursor: 'pointer',
            display: 'flex', alignItems: 'center', padding: 0,
          }}
          onMouseEnter={e => (e.currentTarget.style.color = K.coral)}
          onMouseLeave={e => (e.currentTarget.style.color = 'rgba(255,255,255,0.55)')}
        >
          <LogOut size={15} />
        </button>
      </div>
    </header>
  );
}

export function ProfileChipMobile() {
  return null;
}
