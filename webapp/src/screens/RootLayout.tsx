import { Outlet } from "@tanstack/react-router";
import { Component, lazy, Suspense, type ReactNode } from "react";
import { AppShell } from "../components/AppShell";
import { ErrorState } from "../components/ErrorState";
import { RateLimitedState } from "../components/RateLimitedState";
import { Skeleton } from "../components/Skeleton";
import { useAuth } from "../lib/auth";
import { RegistrationIntentProvider } from "../lib/registrationIntent";
import { CatalogRegionProvider } from "../lib/catalogRegion";
import { LoginScreen } from "./LoginScreen";

const RouterDevtools = import.meta.env.DEV
  ? lazy(() =>
      import("@tanstack/react-router-devtools").then((m) => ({ default: m.TanStackRouterDevtools }))
    )
  : null;

function FullScreenLoading() {
  return (
    <main className="shell">
      <section className="card loading-skeleton-card">
        <Skeleton size="title" width="sixty" />
        <Skeleton width="ninety" />
        <Skeleton width="eighty" />
      </section>
    </main>
  );
}

function LazyRouteLoading() {
  return (
    <section className="shell" role="status" aria-live="polite" aria-label="Загружаем раздел">
      <div className="card loading-skeleton-card">
        <Skeleton size="title" width="sixty" />
        <Skeleton width="ninety" />
        <Skeleton width="eighty" />
      </div>
    </section>
  );
}

class LazyRouteBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  override state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  override render() {
    if (this.state.error) {
      return (
        <section className="shell">
          <ErrorState
            message="Не удалось загрузить раздел."
            onRetry={() => window.location.reload()}
          />
        </section>
      );
    }

    return this.props.children;
  }
}

/** Гейт авторизации + общий каркас с нижней навигацией. Login/Register рендерятся вне AppShell. */
export function RootLayout() {
  const { status, error, retryAfterSeconds, retry } = useAuth();

  let content: React.ReactNode;
  if (status === "loading") {
    content = <FullScreenLoading />;
  } else if (status === "needsLogin") {
    content = <LoginScreen />;
  } else if (status === "rateLimited") {
    content = (
      <main className="shell">
        <RateLimitedState retryAfterSeconds={retryAfterSeconds} onRetry={retry} />
      </main>
    );
  } else if (status === "error") {
    content = (
      <main className="shell">
        <ErrorState message={error ?? undefined} onRetry={retry} />
      </main>
    );
  } else {
    content = (
      <CatalogRegionProvider>
        <RegistrationIntentProvider>
          <AppShell>
            <LazyRouteBoundary>
              <Suspense fallback={<LazyRouteLoading />}>
                <Outlet />
              </Suspense>
            </LazyRouteBoundary>
          </AppShell>
        </RegistrationIntentProvider>
      </CatalogRegionProvider>
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
