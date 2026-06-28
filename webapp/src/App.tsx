import { useEffect } from "react";
import { useAuth } from "./lib/auth";
import { initTelegram } from "./lib/telegram";
import { HomePlaceholder } from "./screens/HomePlaceholder";
import { LoginScreen } from "./screens/LoginScreen";
import { RegisterScreen } from "./screens/RegisterScreen";

function Centered({ children, tone }: { children: React.ReactNode; tone?: "error" | "muted" }) {
  return (
    <main className="shell">
      <section className="card">
        <p className={tone === "error" ? "error" : "muted"}>{children}</p>
      </section>
    </main>
  );
}

export function App() {
  const { status, profile, error } = useAuth();

  useEffect(() => {
    initTelegram();
  }, []);

  if (status === "loading") {
    return <Centered>Загрузка…</Centered>;
  }

  if (status === "needsLogin") {
    return <LoginScreen />;
  }

  if (status === "error") {
    return <Centered tone="error">Не удалось войти: {error}</Centered>;
  }

  // status === "ready" → профиль точно есть.
  if (profile && !profile.isRegistered) {
    return <RegisterScreen />;
  }

  if (profile) {
    return <HomePlaceholder profile={profile} />;
  }

  return <Centered>Загрузка…</Centered>;
}
