import { useMutation, useQuery } from "@tanstack/react-query";
import { apiFetch, clearToken, getToken, setToken } from "@/lib/apiClient";
import { API_ENDPOINTS } from "@/config/api";
import { auth } from "@/lib/auth";

type UserBasic = {
  id: number;
  email: string;
  nombre: string | null;
  apellido: string | null;
  plan?: string | null;
  es_agente?: boolean | null;
  perfil_busqueda?: string | null;
  onboarding_completado?: boolean | null;
  origen_registro?: string | null;
};

type PerfilInversor = {
  objetivo?: string;
  presupuesto?: string;
  perfil_riesgo?: string;
} | null;

export type AuthResponse = {
  token: string;
  user: UserBasic;
  perfil_inversor: PerfilInversor;
};

function storeAuth(res: AuthResponse) {
  if (res.token) setToken(res.token);
  auth.set({
    name: [res.user.nombre, res.user.apellido].filter(Boolean).join(" ") || res.user.email,
    email: res.user.email,
    plan: (res.user.plan ?? "free") as never,
    esAgente: res.user.es_agente ?? false,
    goal: (res.perfil_inversor?.objetivo as never) ?? undefined,
    budget: (res.perfil_inversor?.presupuesto as never) ?? undefined,
    risk: (res.perfil_inversor?.perfil_riesgo as never) ?? undefined,
    perfilBusqueda: (res.user.perfil_busqueda as never) ?? undefined,
    onboardingCompletado: res.user.onboarding_completado ?? false,
    origenRegistro: res.user.origen_registro ?? undefined,
  });
}

// /auth/register no longer returns a session: the account is unusable until the
// emailed link is clicked, so there is no token/user to store here.
export type RegisterResponse = { ok: boolean; verification_required: boolean; message: string };

export function useRegister() {
  return useMutation({
    mutationFn: async (data: { email: string; password: string; nombre?: string; telefono?: string; origen?: string }) => {
      return apiFetch<RegisterResponse>(API_ENDPOINTS.register, {
        method: "POST",
        body: JSON.stringify(data),
        skipAuth: true,
      });
    },
  });
}

export function useResendVerification() {
  return useMutation({
    mutationFn: async (data: { email: string }) =>
      apiFetch<{ message: string }>(API_ENDPOINTS.resendVerification, {
        method: "POST",
        body: JSON.stringify(data),
        skipAuth: true,
      }),
  });
}

export function useLogin() {
  return useMutation({
    mutationFn: async (data: { email: string; password: string }) => {
      const res = await apiFetch<AuthResponse>(API_ENDPOINTS.login, {
        method: "POST",
        body: JSON.stringify(data),
        skipAuth: true,
      });
      storeAuth(res);
      return res;
    },
  });
}

export function useGoogleLogin() {
  return useMutation({
    mutationFn: async (data: { id_token: string }) => {
      const res = await apiFetch<AuthResponse & { challenge?: string; message?: string }>(API_ENDPOINTS.googleLogin, {
        method: "POST",
        body: JSON.stringify(data),
        skipAuth: true,
      });
      // 202: the Google address could not be trusted on its own; a sign-in link was e-mailed instead.
      if (res.challenge || !res.token) {
        throw new Error(res.message || "Te enviamos un enlace de acceso a tu correo.");
      }
      storeAuth(res);
      return res;
    },
  });
}

export function useMagicLinkRequest() {
  return useMutation({
    mutationFn: async (data: { email: string }) => {
      return apiFetch<{ message: string }>(API_ENDPOINTS.magicLink, {
        method: "POST",
        body: JSON.stringify(data),
        skipAuth: true,
      });
    },
  });
}

export function useMagicLinkVerify() {
  return useMutation({
    mutationFn: async (data: { token: string }) => {
      const res = await apiFetch<AuthResponse>(API_ENDPOINTS.magicLinkVerify, {
        method: "POST",
        body: JSON.stringify(data),
        skipAuth: true,
      });
      storeAuth(res);
      return res;
    },
  });
}

export function useMe() {
  return useQuery({
    queryKey: ["me"],
    queryFn: () => apiFetch<AuthResponse>(API_ENDPOINTS.me),
    enabled: !!getToken(),
    staleTime: 10 * 60 * 1000,
    retry: false,
  });
}

export function useUpdateAuthPerfil() {
  return useMutation({
    mutationFn: async (data: {
      perfil_busqueda?: string;
      onboarding_completado?: boolean;
      origen_registro?: string;
    }) => {
      await apiFetch(API_ENDPOINTS.authPerfil, {
        method: "PATCH",
        body: JSON.stringify(data),
      });
      if (data.perfil_busqueda !== undefined)
        auth.patch({ perfilBusqueda: data.perfil_busqueda as never });
      if (data.onboarding_completado !== undefined)
        auth.patch({ onboardingCompletado: data.onboarding_completado });
    },
  });
}

export async function logout() {
  const token = getToken();
  // Clear local session synchronously first — must not depend on the network.
  clearToken();
  auth.clear();
  if (token) {
    try {
      await fetch(API_ENDPOINTS.logout, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      });
    } catch {
      // best-effort — local session already cleared above
    }
  }
}
