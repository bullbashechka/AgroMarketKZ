import { Outlet } from "@tanstack/react-router";
import { lazy, Suspense } from "react";
import { AppShell } from "../components/AppShell";
import { ErrorState } from "../components/ErrorState";
import { Skeleton } from "../components/Skeleton";
import { useAuth } from "../lib/auth";
import { RegistrationIntentProvider } from "../lib/registrationIntent";
import { LoginScreen } from "./LoginScreen";

const RouterDevtools = import.meta.env.DEV
  ? lazy(() =>
      import("@tanstack/react-router-devtools").then((m) => ({ default: m.TanStackRouterDevtools }))
    )
  : null;

function FullScreenLoading() {
  return (
    <main className="shell">
      <section className="card" style={{ display: "grid", gap: 12 }}>
        <Skeleton height={28} width="60%" />
        <Skeleton height={16} width="90%" />
        <Skeleton height={16} width="80%" />
      </section>
    </main>
  );
}

/** Гейт авторизации + общий каркас с нижней навигацией. Login/Register рендерятся вне AppShell. */
export function RootLayout() {
  const { status, error, retry } = useAuth();

  let content: React.ReactNode;
  if (status === "loading") {
    content = <FullScreenLoading />;
  } else if (status === "needsLogin") {
    content = <LoginScreen />;
  } else if (status === "error") {
    content = (
      <main className="shell">
        <ErrorState message={error ?? undefined} onRetry={retry} />
      </main>
    );
  } else {
    content = (
      <RegistrationIntentProvider>
        <AppShell>
          <Outlet />
        </AppShell>
      </RegistrationIntentProvider>
    );
  }

  return (
    <>
      {content}
      {RouterDevtools && (
        <Suspense fallback={null}>
          <RouterDevtools position="top-right" />
        </Suspense>
      )}
    </>
  );
}
