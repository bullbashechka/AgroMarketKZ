import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider } from "@tanstack/react-router";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { ApiError } from "./lib/api";
import { AuthProvider } from "./lib/auth";
import { consumeStartParam } from "./lib/startParam";
import { initTelegram } from "./lib/telegram";
import { initThemeSync } from "./lib/theme";
import { router } from "./router";
import "./styles/tokens.css";
import "./styles/base.css";
import "./styles/components.css";

// SDK-скрипт Telegram подключён синхронно в index.html — можно вызывать сразу, до рендера.
initTelegram();
initThemeSync();
// Deep-link из Telegram-уведомления (startapp) — до первого рендера, чтобы
// приложение сразу открылось на нужном экране.
consumeStartParam(router);

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Кэш показывается мгновенно; фон-обновление — не чаще раза в минуту (слабая связь в поле).
      staleTime: 60_000,
      gcTime: 30 * 60_000,
      retry: (failureCount, error) =>
        failureCount < 2 && !(error instanceof ApiError && error.status >= 400 && error.status < 500),
      refetchOnWindowFocus: false,
      refetchOnReconnect: true
    },
    mutations: { retry: 0 }
  }
});

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <RouterProvider router={router} />
      </AuthProvider>
    </QueryClientProvider>
  </StrictMode>
);
