import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { realtorApi, type ItemPool, type ZonaNivel } from "@/lib/realtorApi";
import { apiFetch } from "@/lib/apiClient";
import { API_BASE_URL } from "@/config/api";

export type EmbudoZona = {
  zona_codigo: string; zona_nombre: string; nivel: string;
  vistas_mapa: number; aperturas_detalle: number; favoritos: number; visitas: number;
};
export type Embudo = {
  vistas_mapa: number; aperturas_detalle: number; favoritos: number; visitas: number;
  zonas: EmbudoZona[];
};

/** Embudo de demanda (30d) de las zonas patrocinadas: vistas→detalle→favoritos→visitas. */
export function useEmbudo() {
  return useQuery({
    queryKey: ["realtor", "embudo"],
    queryFn: () => apiFetch<Embudo>(`${API_BASE_URL}/realtor/embudo`),
    staleTime: 5 * 60 * 1000,
  });
}

export function useRealtorPerfil() {
  return useQuery({
    queryKey: ["realtor", "perfil"],
    queryFn: () => realtorApi.getPerfil(),
    staleTime: 5 * 60 * 1000,
  });
}

export function useRealtorAsignados() {
  return useQuery({
    queryKey: ["realtor", "asignados"],
    queryFn: () => realtorApi.getAsignados(),
    staleTime: 60 * 1000,
  });
}

export function useRealtorPool() {
  return useQuery({
    queryKey: ["realtor", "pool"],
    queryFn: () => realtorApi.getPool(),
    staleTime: 30 * 1000,
  });
}

export function useTomarDelPool() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => realtorApi.tomarDelPool(id),
    onMutate: async (id) => {
      await qc.cancelQueries({ queryKey: ["realtor", "pool"] });
      const prev = qc.getQueryData<ItemPool[]>(["realtor", "pool"]);
      qc.setQueryData<ItemPool[]>(["realtor", "pool"], (old) => old?.filter((p) => p.id !== id) ?? []);
      return { prev };
    },
    onError: (_, __, ctx) => {
      if (ctx?.prev) qc.setQueryData(["realtor", "pool"], ctx.prev);
      toast.error("No se pudo tomar el inmueble");
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ["realtor", "pool"] }),
  });
}

export function useMisListings() {
  return useQuery({
    queryKey: ["realtor", "listings"],
    queryFn: () => realtorApi.getMisListings(),
    staleTime: 60 * 1000,
  });
}

export function usePublicarAsignado() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (intakeId: string) => realtorApi.publicarAsignado(intakeId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["realtor", "asignados"] });
      qc.invalidateQueries({ queryKey: ["realtor", "listings"] });
    },
    onError: () => toast.error("No se pudo publicar el listing"),
  });
}

export function useAceptarAsignado() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (intakeId: string) => realtorApi.aceptarAsignado(intakeId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["realtor", "asignados"] });
      qc.invalidateQueries({ queryKey: ["realtor", "desempeno"] });
    },
    onError: () => toast.error("No se pudo aceptar el inmueble"),
  });
}

export function useDesempeno() {
  return useQuery({
    queryKey: ["realtor", "desempeno"],
    queryFn: () => realtorApi.getDesempeno(),
    staleTime: 5 * 60 * 1000,
  });
}

export function useAgenda() {
  return useQuery({
    queryKey: ["realtor", "agenda"],
    queryFn: () => realtorApi.getAgenda(),
    staleTime: 60 * 1000,
  });
}

export function useActualizarVisita() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, estado, resultado }: {
      id: string;
      estado: "confirmada" | "realizada" | "cancelada" | "no_asistio";
      resultado?: "interesado" | "oferta" | "descartado";
    }) => realtorApi.actualizarVisita(id, estado, resultado),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["realtor", "agenda"] });
      qc.invalidateQueries({ queryKey: ["realtor", "desempeno"] });
    },
    onError: () => toast.error("No se pudo actualizar la visita"),
  });
}

export function useDueDiligence(intakeId: string | null) {
  return useQuery({
    queryKey: ["realtor", "dd", intakeId],
    queryFn: () => realtorApi.getDueDiligence(intakeId!),
    enabled: intakeId !== null,
    staleTime: 30 * 1000,
  });
}

export function useVerificarDDItem(intakeId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ itemId, estado, nota }: { itemId: string; estado: "verificado" | "rechazado"; nota?: string }) =>
      realtorApi.verificarDDItem(itemId, estado, nota),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["realtor", "dd", intakeId] });
      qc.invalidateQueries({ queryKey: ["realtor", "asignados"] });
    },
    onError: () => toast.error("No se pudo guardar la verificación"),
  });
}

export function useEditarListing() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ listingId, campos, fotos }: {
      listingId: string;
      campos: import("@/lib/realtorApi").ListingPatch;
      fotos: File[];
    }) => {
      if (Object.keys(campos).length > 0) await realtorApi.actualizarListing(listingId, campos);
      if (fotos.length > 0) await realtorApi.subirFotosListing(listingId, fotos);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["realtor", "asignados"] });
      qc.invalidateQueries({ queryKey: ["realtor", "listings"] });
    },
    onError: () => toast.error("No se pudo guardar la ficha"),
  });
}

export function useCerrarListing() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ listingId, input }: { listingId: string; input: import("@/lib/realtorApi").CerrarListingInput }) =>
      realtorApi.cerrarListing(listingId, input),
    onSuccess: () => {
      // Reportar el cierre: cambia listings, sube standing y DESBLOQUEA comparables.
      qc.invalidateQueries({ queryKey: ["realtor", "listings"] });
      qc.invalidateQueries({ queryKey: ["realtor", "desempeno"] });
      qc.invalidateQueries({ queryKey: ["realtor", "comparables"] });
      toast.success("Cierre reportado. Desbloqueaste los comparables de cierre.");
    },
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : "No se pudo reportar el cierre"),
  });
}

export function useComparables(params?: { barrioId?: number; tipoInmueble?: string; operacion?: string; meses?: number }) {
  return useQuery({
    queryKey: ["realtor", "comparables", params ?? null],
    queryFn: () => realtorApi.getComparables(params),
    staleTime: 60 * 1000,
  });
}

export function useInteligenciaBarrio(zonaCodigo: string | null, nivel?: ZonaNivel) {
  return useQuery({
    queryKey: ["realtor", "inteligencia", zonaCodigo, nivel],
    queryFn: () => realtorApi.getInteligenciaBarrio(zonaCodigo!, nivel),
    enabled: zonaCodigo !== null,
    staleTime: 5 * 60 * 1000,
  });
}
