export type Goal = "airbnb" | "renta-larga" | "valorizacion" | "mediano_plazo";
export type Risk = "conservador" | "moderado" | "agresivo";
export type Budget = "<200" | "200-500" | "500-1000" | ">1000";
export type UserType = "investor" | "explorer";

export type PaymentMethod = {
  id: string;
  type: "card" | "pse" | "nequi";
  label: string;
  last4?: string;
  holder?: string;
};

export type FavoriteBarrio = {
  id: number;
  nombre: string;
  yield: number | null;
  savedAt: number;
  note?: string;
};

export type HistoryEntry = {
  id: string;
  ts: number;
  type: "view" | "calc" | "favorite" | "compare";
  label: string;
  barrioId?: number;
};

export type MapStyleId = "dark" | "night" | "satellite" | "light" | "monochrome";

export type PerfilBusqueda = 'comprador' | 'inversor' | 'vendedor' | 'agente';

export type UrbiUser = {
  name: string;
  email: string;
  avatar?: string;          // data URL or remote URL
  password?: string;        // mock only — never do this in production
  userType?: UserType;
  budget?: Budget;
  goal?: Goal;
  risk?: Risk;
  // Extended onboarding profile fields
  nUnidades?: string;
  tipoGestion?: string;
  targetInquilino?: string;
  amoblado?: string;
  tipoPago?: string;
  horizonteInversion?: string;
  primeraPropiedad?: boolean;
  wantsAgent?: boolean;
  plan?: 'free' | 'pro' | 'agente';
  esAgente?: boolean;          // true si tiene fila activa en `agent` (agente o agencia)
  payments?: PaymentMethod[];
  favorites?: FavoriteBarrio[];
  history?: HistoryEntry[];
  mapStyle?: MapStyleId;
  mostrarOportunidades?: boolean;
  // Onboarding v2
  perfilBusqueda?: PerfilBusqueda | null;
  onboardingCompletado?: boolean;
  origenRegistro?: string | null;
};

const KEY = "medellin-social.user";

export const auth = {
  get(): UrbiUser | null {
    if (typeof window === "undefined") return null;
    try {
      const raw = localStorage.getItem(KEY);
      if (!raw) return null;
      const u = JSON.parse(raw) as UrbiUser;
      // Migrate legacy goal value
      if ((u.goal as string) === "nomadas") u.goal = "mediano_plazo";
      return u;
    } catch {
      return null;
    }
  },
  set(u: UrbiUser) {
    localStorage.setItem(KEY, JSON.stringify(u));
    if (typeof window !== "undefined") {
      window.dispatchEvent(new CustomEvent("medellin-social:user"));
    }
  },
  patch(p: Partial<UrbiUser>) {
    const cur = auth.get() ?? { name: "", email: "" };
    auth.set({ ...cur, ...p });
  },
  clear() {
    localStorage.removeItem(KEY);
    if (typeof window !== "undefined") {
      window.dispatchEvent(new CustomEvent("medellin-social:user"));
    }
  },
  toggleFavorite(fav: Omit<FavoriteBarrio, "savedAt">) {
    const cur = auth.get();
    if (!cur) return;
    const list = cur.favorites ?? [];
    const exists = list.some((f) => f.id === fav.id);
    const next = exists
      ? list.filter((f) => f.id !== fav.id)
      : [...list, { ...fav, savedAt: Date.now() }];
    auth.set({ ...cur, favorites: next });
    auth.pushHistory({
      type: "favorite",
      label: exists ? `Removió ${fav.nombre} de favoritos` : `Guardó ${fav.nombre} en favoritos`,
      barrioId: fav.id,
    });
  },
  isFavorite(id: number): boolean {
    return !!auth.get()?.favorites?.some((f) => f.id === id);
  },
  pushHistory(entry: Omit<HistoryEntry, "id" | "ts">) {
    const cur = auth.get();
    if (!cur) return;
    const list = cur.history ?? [];
    const item: HistoryEntry = { ...entry, id: crypto.randomUUID(), ts: Date.now() };
    // keep last 50
    const next = [item, ...list].slice(0, 50);
    auth.set({ ...cur, history: next });
  },
};

const TOKEN_KEY = "medellin-social.token";
const REFRESH_THRESHOLD_MS = 7 * 24 * 60 * 60 * 1000; // refresh if < 7 days left

function _decodeJwtExp(token: string): number | null {
  try {
    const payload = JSON.parse(atob(token.split(".")[1]));
    return typeof payload.exp === "number" ? payload.exp * 1000 : null;
  } catch {
    return null;
  }
}

export async function refreshIfExpiringSoon(): Promise<void> {
  if (typeof window === "undefined") return;
  const { COOKIE_MODE, authHeaders, authCredentials, getToken, setToken } = await import("@/lib/apiClient");
  if (!getToken()) return;
  if (COOKIE_MODE) {
    // The JWT is unreadable here (HttpOnly): refresh at most once a day instead.
    const k = "medellin-social.session.refreshedAt";
    if (Date.now() - Number(localStorage.getItem(k) || 0) < 24 * 60 * 60 * 1000) return;
    localStorage.setItem(k, String(Date.now()));
  } else {
    const exp = _decodeJwtExp(localStorage.getItem(TOKEN_KEY) || "");
    if (!exp) return;
    if (exp - Date.now() > REFRESH_THRESHOLD_MS) return;
  }

  try {
    const { API_ENDPOINTS } = await import("@/config/api");
    const res = await fetch(API_ENDPOINTS.refreshToken, {
      method: "POST",
      headers: authHeaders(),
      credentials: authCredentials,
    });
    if (!res.ok) return;
    const data = await res.json();
    if (data.token) setToken(data.token);
  } catch {
    // silent — old token remains valid until it actually expires
  }
}

export const GOAL_LABEL: Record<Goal, string> = {
  airbnb: "Renta Corta",
  mediano_plazo: "Renta media",
  "renta-larga": "Renta larga",
  valorizacion: "Valorización",
};

export const MAP_STYLES: Record<MapStyleId, { label: string; url: string; swatch: string[] }> = {
  dark: {
    label: "Cyber Dark",
    url: "mapbox://styles/mapbox/dark-v11",
    swatch: ["#0B0D12", "#111827", "#1F5BC6", "#003893"],
  },
  night: {
    label: "Midnight Indigo",
    url: "mapbox://styles/mapbox/navigation-night-v1",
    swatch: ["#0a0a1a", "#141432", "#1e1e5a", "#4f46e5"],
  },
  satellite: {
    label: "Satélite",
    url: "mapbox://styles/mapbox/satellite-streets-v12",
    swatch: ["#1a1a1a", "#3a4a2a", "#7d9b76", "#e8b84a"],
  },
  light: {
    label: "Paper & Ink",
    url: "mapbox://styles/mapbox/light-v11",
    swatch: ["#f5f3ee", "#e8e4dd", "#2d2d2d", "#0d0d0d"],
  },
  monochrome: {
    label: "Mono Slate",
    url: "mapbox://styles/mapbox/streets-v12",
    swatch: ["#2d3748", "#4a5568", "#718096", "#a0aec0"],
  },
};

export function recommendation(goal?: Goal): string {
  switch (goal) {
    case "airbnb":
      return "🎯 Para tu perfil Airbnb, El Poblado y Laureles tienen la mayor demanda de renta corta estimada. Yield promedio zona: 7.4%";
    case "renta-larga":
      return "🏠 Para renta larga, Robledo y Aranjuez ofrecen el mejor balance precio/arriendo con baja vacancia.";
    case "valorizacion":
      return "📈 Para valorización, El Rodeo y Robledo muestran el mayor potencial de apreciación a 5 años.";
    case "mediano_plazo":
      return "📅 Para renta media (1-6 meses), El Poblado y Laureles lideran en yield renta media y demanda de ejecutivos y profesionales en movilidad.";
    default:
      return "Selecciona un barrio en el mapa para ver análisis detallado.";
  }
}
