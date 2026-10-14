// Environment-aware API base — zero manual switching between local and prod:
//   - `npm run dev`   → import.meta.env.DEV → local API
//   - `npm run build` → prod bundle         → Railway API
//   - VITE_API_URL (en .env.local o build ARG de Railway) overridea ambos.
const API_BASE_URL =
  (import.meta.env.VITE_API_URL as string | undefined) ??
  (import.meta.env.DEV
    ? "http://localhost:8011/api/v1"   // API local corre en 8011 (8001 lo secuestra Cursor)
    : "https://medellinsocial-api.up.railway.app/api/v1");

export const API_ENDPOINTS = {
  // Auth
  register: `${API_BASE_URL}/auth/register`,
  login: `${API_BASE_URL}/auth/login`,
  googleLogin: `${API_BASE_URL}/auth/google`,
  me: `${API_BASE_URL}/auth/me`,
  logout: `${API_BASE_URL}/auth/logout`,
  refreshToken: `${API_BASE_URL}/auth/refresh`,
  forgotPassword: `${API_BASE_URL}/auth/forgot-password`,
  resetPassword: `${API_BASE_URL}/auth/reset-password`,
  magicLink: `${API_BASE_URL}/auth/magic-link`,
  magicLinkVerify: `${API_BASE_URL}/auth/magic-link/verificar`,

  // Barrios
  barrios: `${API_BASE_URL}/barrios`,
  barrio: (id: number) => `${API_BASE_URL}/barrios/${id}`,
  barrioInfo: (id: number) => `${API_BASE_URL}/barrios/${id}/info`,
  comparar: `${API_BASE_URL}/barrios/comparar`,
  barrioAliases: `${API_BASE_URL}/barrios/aliases`,
  barrioBuscar: (q: string) => `${API_BASE_URL}/barrios/buscar?q=${encodeURIComponent(q)}`,
  listings: (id: number) => `${API_BASE_URL}/barrios/${id}/listings`,
  allListings: `${API_BASE_URL}/listings`,
  trm: `${API_BASE_URL}/trm`,
  listing: (id: number) => `${API_BASE_URL}/listings/${id}`,
  listingVista: (id: number) => `${API_BASE_URL}/listings/${id}/vista`,
  listingReclamar: (id: number) => `${API_BASE_URL}/listings/${id}/reclamar`,
  listingSimilares: (id: number) => `${API_BASE_URL}/listings/${id}/similares`,
  listingAgente: (id: number) => `${API_BASE_URL}/listings/${id}/agente`,
  agentesDirectorio: `${API_BASE_URL}/listings/agentes`,
  agentePerfil: (id: string) => `${API_BASE_URL}/listings/agentes/${id}`,
  agenteResenas: (id: string) => `${API_BASE_URL}/listings/agentes/${id}/resenas`,
  listingSlots: (id: number) => `${API_BASE_URL}/listings/${id}/slots`,
  visitas: `${API_BASE_URL}/visitas`,
  track: `${API_BASE_URL}/track`,

  // Usuario
  onboarding: `${API_BASE_URL}/usuario/onboarding`,
  perfil: `${API_BASE_URL}/usuario/perfil`,
  authPerfil: `${API_BASE_URL}/auth/perfil`,
  configMapa: `${API_BASE_URL}/usuario/configuracion_mapa`,
  suscribirse: `${API_BASE_URL}/usuario/suscribirse`,

  // Admin
  adminDashboard: `${API_BASE_URL}/admin/dashboard`,
  adminUsuarios: `${API_BASE_URL}/admin/usuarios`,
  adminUsuarioEditar: (id: number) => `${API_BASE_URL}/admin/usuarios/${id}`,
  adminLeads: `${API_BASE_URL}/admin/leads`,
  adminLead: (id: number) => `${API_BASE_URL}/admin/leads/${id}`,
  adminEventos: `${API_BASE_URL}/admin/eventos`,
  adminEventoEditar: (id: number) => `${API_BASE_URL}/admin/eventos/${id}`,
  adminActividad: `${API_BASE_URL}/admin/actividad`,
  adminAuditLog: `${API_BASE_URL}/admin/audit-log`,
  adminTiendas: `${API_BASE_URL}/admin/tiendas`,
  adminTiendaEditar: (id: number) => `${API_BASE_URL}/admin/tiendas/${id}`,
  adminDestacadosCatalogo: `${API_BASE_URL}/admin/destacados-catalogo`,

  // Features
  calculadora: `${API_BASE_URL}/calculadora/simular`,
  simuladorListingData: (id: number) => `${API_BASE_URL}/calculadora/listing-simulador-data?listing_id=${id}`,
  simuladorAlternativas: `${API_BASE_URL}/calculadora/alternativas`,
  oportunidades: `${API_BASE_URL}/oportunidades`,
  favoritos: `${API_BASE_URL}/favoritos`,
  historial: `${API_BASE_URL}/historial`,
  ciudadStats: `${API_BASE_URL}/stats/ciudad`,
  scoreThresholds: `${API_BASE_URL}/stats/score-thresholds`,

  // Comunidad
  comunidadEventos: (barrioId: number) => `${API_BASE_URL}/comunidad/${barrioId}/eventos`,
  comunidadTiendas: (barrioId: number) => `${API_BASE_URL}/comunidad/${barrioId}/tiendas`,
  ticker: (ciudadId = 1) => `${API_BASE_URL}/comunidad/ticker?ciudad_id=${ciudadId}`,
  todosEventos: `${API_BASE_URL}/comunidad/todos/eventos?limit=20`,
  todosTiendas: `${API_BASE_URL}/comunidad/todos/tiendas?limit=4`,
  comunasTiendasCounts: `${API_BASE_URL}/comunidad/comunas/tiendas-counts`,

  // Comunas (MLS visual layer)
  comunasGeoJSON: `${API_BASE_URL}/comunas/geojson`,
  comunasBarrios: (nombre: string) => `${API_BASE_URL}/comunas/${encodeURIComponent(nombre)}/barrios`,
  comunasBarriosByCd: (cd: number) => `${API_BASE_URL}/comunas/cd/${cd}/barrios`,

  // Verificación de agentes (tabla `agent` UUID, 0045)
  adminAgentes: `${API_BASE_URL}/admin/agentes`,
  adminAgenteAprobar: (id: string) => `${API_BASE_URL}/admin/agentes/${id}/aprobar`,
  adminAgenteRechazar: (id: string) => `${API_BASE_URL}/admin/agentes/${id}/rechazar`,
  adminAgenteSuspender: (id: string) => `${API_BASE_URL}/admin/agentes/${id}/suspender`,
  adminAgenteZonas: (id: string) => `${API_BASE_URL}/admin/agentes/${id}/zonas`,
  adminSponsorshipDelete: (id: string) => `${API_BASE_URL}/admin/sponsorship/${id}`,
  adminZonasCatalogo: `${API_BASE_URL}/admin/zonas-catalogo`,
  adminListingsEnRevision: `${API_BASE_URL}/admin/listings/en-revision`,
  adminListingAprobar: (id: string) => `${API_BASE_URL}/admin/listings/${id}/aprobar`,
  adminListingRechazar: (id: string) => `${API_BASE_URL}/admin/listings/${id}/rechazar`,
  // Compra de zonas (realtor self-serve)
  zonasDisponibles: `${API_BASE_URL}/zonas/disponibles`,
  zonasCheckout: `${API_BASE_URL}/zonas/checkout`,
  zonasConfirmarSimulado: `${API_BASE_URL}/zonas/confirmar-simulado`,

  // Listings propios
  listingsPropios: `${API_BASE_URL}/listings-propios`,
  listingsPropiosMe: `${API_BASE_URL}/listings-propios/me`,
  listingsPropiosMis: `${API_BASE_URL}/listings-propios/mis-listings`,
  listingsPropiosById: (id: number) => `${API_BASE_URL}/listings-propios/${id}`,
  listingsPropiosBarriosForm: `${API_BASE_URL}/listings-propios/barrios-form`,
  listingsPropiosOtpEnviar: `${API_BASE_URL}/listings-propios/verificar-telefono/enviar`,
  listingsPropiosOtpConfirmar: `${API_BASE_URL}/listings-propios/verificar-telefono/confirmar`,
  listingsPropiosAgentes: `${API_BASE_URL}/listings-propios/agentes-para-contactar`,
  listingsPropiosSolicitudes: `${API_BASE_URL}/listings-propios/solicitudes`,
  listingsPropiosSolicitudesPendientes: `${API_BASE_URL}/listings-propios/solicitudes/pendientes`,
  listingsPropiosSolicitudById: (id: number) => `${API_BASE_URL}/listings-propios/solicitudes/${id}`,

  // Alertas de precio
  alertasCrear: `${API_BASE_URL}/alertas`,
  alertasMis: `${API_BASE_URL}/alertas/mis`,
  alertaDesactivar: (id: number) => `${API_BASE_URL}/alertas/${id}`,

  // Suscripciones
  suscripcionesPlanes: `${API_BASE_URL}/suscripciones/planes`,
  suscripcionesIniciar: `${API_BASE_URL}/suscripciones/iniciar`,
  suscripcionesMiPlan: `${API_BASE_URL}/suscripciones/mi-plan`,
  suscripcionesCancelar: `${API_BASE_URL}/suscripciones/cancelar`,
  agenteRegistro: `${API_BASE_URL}/suscripciones/agente/registro`,

  // Comparador
  comparadorHistorial: `${API_BASE_URL}/comparador/historial`,
  comparadorHistorialItem: (id: number) => `${API_BASE_URL}/comparador/historial/${id}`,
  comparadorListings: (ids: string) => `${API_BASE_URL}/comparador/listings?ids=${ids}`,

  // Simulador historial
  simuladorHistorial: `${API_BASE_URL}/calculadora/historial`,
  simuladorHistorialItem: (id: number) => `${API_BASE_URL}/calculadora/historial/${id}`,
} as const;

export { API_BASE_URL };
