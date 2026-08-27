import type {
  AuthResponse,
  Profile,
  RegisterInput,
  UpdateProfileInput,
  WidgetLoginInput
} from "@agromarket/contracts";
import { authResponse, profileSchema } from "@agromarket/contracts";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createContext, useContext, useEffect, type ReactNode } from "react";
import {
  ApiError,
  apiGetParsed,
  apiPostParsed,
  apiPutParsed,
  setUnauthorizedHandler,
} from "./api";
import { resetAutoRetries } from "./rateLimitRetry";
import { getInitData, isTelegramContext } from "./telegram";

export const authQueryKeys = {
  profile: ["profile"] as const,
};

/** Сессии нет и автоматически войти нельзя (браузер без входа) → показываем Login Widget. */
class NeedsLoginError extends Error {}

async function loginWithInitData(): Promise<void> {
  const initData = getInitData();
  if (!initData) throw new NeedsLoginError();
  await apiPostParsed<AuthResponse>("/auth/telegram", { initData }, authResponse);
}

/**
 * Bootstrap сессии: запрашиваем профиль по HttpOnly cookie; в Telegram 401 восстанавливает
 * сессию из свежего initData, в браузере показывает Login Widget.
 */
async function bootstrapProfile(onSessionBoundary: () => void): Promise<Profile> {
  try {
    return await apiGetParsed<Profile>("/profile", profileSchema, { notifyUnauthorized: false });
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) {
      onSessionBoundary();
      if (isTelegramContext()) {
        await loginWithInitData();
        return await apiGetParsed<Profile>("/profile", profileSchema, { notifyUnauthorized: false });
      }
      throw new NeedsLoginError();
    }
    throw error;
  }
}

export type AuthStatus = "loading" | "needsLogin" | "rateLimited" | "ready" | "error";

export function classifyAuthStatus(input: {
  profile: Profile | undefined;
  error: unknown;
  isLoading: boolean;
  isError: boolean;
}): AuthStatus {
  if (input.error instanceof NeedsLoginError) return "needsLogin";
  // Do not allow retained TanStack Query data to mask an invalid response from
  // a refetch: profile flags drive route access and must come from a verified payload.
  if (input.isError) {
    return input.error instanceof ApiError && input.error.status === 429
      ? "rateLimited"
      : "error";
  }
  if (input.isLoading) return "loading";
  return input.profile ? "ready" : "loading";
}

interface AuthContextValue {
  profile: Profile | undefined;
  status: AuthStatus;
  error: string | null;
  retryAfterSeconds: number | null;
  loginWidget: (data: WidgetLoginInput) => void;
  loginPending: boolean;
  loginError: string | null;
  register: (data: RegisterInput) => Promise<Profile>;
  registerPending: boolean;
  /** Редактирование контактов в профиле (экран «Мои контакты» + авто-обновление из формы заявки). */
  updateProfile: (data: UpdateProfileInput) => Promise<Profile>;
  updateProfilePending: boolean;
  /** Обновить профиль после атомарной регистрации внутри первой заявки. */
  refreshProfile: () => Promise<Profile | undefined>;
  /** Повторить bootstrap профиля после сбоя сети (status === "error"). */
  retry: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient();

  useEffect(() => {
    setUnauthorizedHandler(async () => {
      // A 401 is a session boundary, not a normal stale-query event. Clear
      // every non-profile query, then let the profile query own re-authentication.
      qc.removeQueries({
        predicate: (query) => query.queryKey[0] !== authQueryKeys.profile[0],
      });
      await qc.invalidateQueries({ queryKey: authQueryKeys.profile, exact: true });
    });
    return () => setUnauthorizedHandler(undefined);
  }, [qc]);

  const profileQuery = useQuery({
    queryKey: authQueryKeys.profile,
    queryFn: () => bootstrapProfile(() => {
      qc.removeQueries({
        predicate: (query) => query.queryKey[0] !== authQueryKeys.profile[0],
      });
    }),
    retry: false,
    staleTime: Infinity,
    refetchOnWindowFocus: false
  });

  useEffect(() => {
    if (profileQuery.data) resetAutoRetries();
  }, [profileQuery.data]);

  const loginMutation = useMutation({
    mutationFn: (data: WidgetLoginInput) => apiPostParsed<AuthResponse>("/auth/widget/exchange", data, authResponse),
    onSuccess: ({ profile }) => {
      qc.setQueryData(authQueryKeys.profile, profile);
    }
  });

  const registerMutation = useMutation({
    mutationFn: (data: RegisterInput) => apiPostParsed<Profile>("/profile/register", data, profileSchema),
    onSuccess: (profile) => qc.setQueryData(authQueryKeys.profile, profile)
  });

  const updateProfileMutation = useMutation({
    mutationFn: (data: UpdateProfileInput) => apiPutParsed<Profile>("/profile", data, profileSchema),
    onSuccess: (profile) => qc.setQueryData(authQueryKeys.profile, profile)
  });

  const status = classifyAuthStatus({
    profile: profileQuery.data,
    error: profileQuery.error,
    isLoading: profileQuery.isLoading,
    isError: profileQuery.isError,
  });

  const value: AuthContextValue = {
    profile: status === "ready" ? profileQuery.data : undefined,
    status,
    retryAfterSeconds:
      status === "rateLimited" && profileQuery.error instanceof ApiError
        ? (profileQuery.error.retryAfterSeconds ?? null)
        : null,
    error:
      profileQuery.isError &&
      !(profileQuery.error instanceof NeedsLoginError) &&
      status !== "rateLimited"
        ? (profileQuery.error instanceof Error ? profileQuery.error.message : "Не удалось загрузить профиль")
        : null,
    loginWidget: loginMutation.mutate,
    loginPending: loginMutation.isPending,
    loginError: loginMutation.isError
      ? (loginMutation.error instanceof Error ? loginMutation.error.message : "Не удалось войти через Telegram")
      : null,
    register: registerMutation.mutateAsync,
    registerPending: registerMutation.isPending,
    updateProfile: updateProfileMutation.mutateAsync,
    updateProfilePending: updateProfileMutation.isPending,
    refreshProfile: async () => (await profileQuery.refetch()).data,
    retry: () => {
      profileQuery.refetch();
    }
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth должен использоваться внутри AuthProvider");
  return ctx;
}
