import type {
  AuthResponse,
  Profile,
  RegisterInput,
  UpdateProfileInput,
  WidgetLoginInput
} from "@agromarket/contracts";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createContext, useContext, type ReactNode } from "react";
import { ApiError, apiGet, apiPost, apiPut } from "./api";
import { getInitData, isTelegramContext } from "./telegram";
import { getToken, setToken } from "./token";

const PROFILE_KEY = ["profile"] as const;

/** Сессии нет и автоматически войти нельзя (браузер без входа) → показываем Login Widget. */
class NeedsLoginError extends Error {}

async function loginWithInitData(): Promise<void> {
  const initData = getInitData();
  if (!initData) throw new NeedsLoginError();
  const { token } = await apiPost<AuthResponse>("/auth/telegram", { initData });
  setToken(token);
}

/**
 * Bootstrap сессии: есть токен → грузим профиль; нет — в Telegram молча логинимся по initData,
 * в браузере отдаём NeedsLoginError (там нужен Login Widget). На 401 в Telegram — повторный вход.
 */
async function bootstrapProfile(): Promise<Profile> {
  if (!getToken()) {
    if (isTelegramContext()) {
      await loginWithInitData();
    } else {
      throw new NeedsLoginError();
    }
  }

  try {
    return await apiGet<Profile>("/profile");
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) {
      if (isTelegramContext()) {
        await loginWithInitData();
        return await apiGet<Profile>("/profile");
      }
      throw new NeedsLoginError();
    }
    throw error;
  }
}

export type AuthStatus = "loading" | "needsLogin" | "ready" | "error";

interface AuthContextValue {
  profile: Profile | undefined;
  status: AuthStatus;
  error: string | null;
  loginWidget: (data: WidgetLoginInput) => void;
  loginPending: boolean;
  register: (data: RegisterInput) => Promise<Profile>;
  registerPending: boolean;
  /** Редактирование контактов в профиле (экран «Мои контакты» + авто-обновление из формы заявки). */
  updateProfile: (data: UpdateProfileInput) => Promise<Profile>;
  updateProfilePending: boolean;
  /** Повторить bootstrap профиля после сбоя сети (status === "error"). */
  retry: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient();

  const profileQuery = useQuery({
    queryKey: PROFILE_KEY,
    queryFn: bootstrapProfile,
    retry: false,
    staleTime: Infinity,
    refetchOnWindowFocus: false
  });

  const loginMutation = useMutation({
    mutationFn: (data: WidgetLoginInput) => apiPost<AuthResponse>("/auth/widget", data),
    onSuccess: ({ token, profile }) => {
      setToken(token);
      qc.setQueryData(PROFILE_KEY, profile);
    }
  });

  const registerMutation = useMutation({
    mutationFn: (data: RegisterInput) => apiPost<Profile>("/profile/register", data),
    onSuccess: (profile) => qc.setQueryData(PROFILE_KEY, profile)
  });

  const updateProfileMutation = useMutation({
    mutationFn: (data: UpdateProfileInput) => apiPut<Profile>("/profile", data),
    onSuccess: (profile) => qc.setQueryData(PROFILE_KEY, profile)
  });

  let status: AuthStatus;
  if (profileQuery.data) {
    status = "ready";
  } else if (profileQuery.isLoading) {
    status = "loading";
  } else if (profileQuery.error instanceof NeedsLoginError) {
    status = "needsLogin";
  } else if (profileQuery.isError) {
    status = "error";
  } else {
    status = "loading";
  }

  const value: AuthContextValue = {
    profile: profileQuery.data,
    status,
    error:
      profileQuery.isError && !(profileQuery.error instanceof NeedsLoginError)
        ? (profileQuery.error as Error).message
        : null,
    loginWidget: loginMutation.mutate,
    loginPending: loginMutation.isPending,
    register: registerMutation.mutateAsync,
    registerPending: registerMutation.isPending,
    updateProfile: updateProfileMutation.mutateAsync,
    updateProfilePending: updateProfileMutation.isPending,
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
