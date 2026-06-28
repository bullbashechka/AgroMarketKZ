import { healthResponseSchema, type HealthResponse } from "@agromarket/contracts";
import { useEffect, useState } from "react";

type HealthState =
  | { status: "loading" }
  | { status: "available"; data: HealthResponse }
  | { status: "invalid" }
  | { status: "unavailable" };

const apiUrl = (import.meta.env.VITE_API_URL ?? "http://localhost:3000").replace(/\/$/, "");

export function App() {
  const [health, setHealth] = useState<HealthState>({ status: "loading" });

  useEffect(() => {
    const controller = new AbortController();

    async function checkBackend() {
      try {
        const response = await fetch(`${apiUrl}/health`, {
          signal: controller.signal
        });

        if (!response.ok) {
          setHealth({ status: "unavailable" });
          return;
        }

        const payload: unknown = await response.json();
        const parsed = healthResponseSchema.safeParse(payload);

        setHealth(parsed.success ? { status: "available", data: parsed.data } : { status: "invalid" });
      } catch (error) {
        if (!controller.signal.aborted) {
          setHealth({ status: "unavailable" });
        }
      }
    }

    void checkBackend();

    return () => {
      controller.abort();
    };
  }, []);

  return (
    <main className="shell">
      <section className="card" aria-labelledby="status-title">
        <p className="eyebrow">Этап 0</p>
        <h1 id="status-title">AgroMarketKZ webapp работает</h1>
        <p className="description">Технический экран проверки локальной связки webapp, backend и contracts.</p>

        <dl className="status-list">
          <div>
            <dt>Webapp</dt>
            <dd className="ok">работает</dd>
          </div>
          <div>
            <dt>Backend</dt>
            <BackendStatus health={health} />
          </div>
          <div>
            <dt>Contracts</dt>
            <dd className={health.status === "available" ? "ok" : "muted"}>
              {health.status === "available" ? "подключены" : "ожидают корректный ответ backend"}
            </dd>
          </div>
        </dl>

        <p className="api-url">API: {apiUrl}</p>
      </section>
    </main>
  );
}

function BackendStatus({ health }: { health: HealthState }) {
  if (health.status === "loading") {
    return <dd className="muted">проверяется</dd>;
  }

  if (health.status === "available") {
    return <dd className="ok">доступен ({health.data.app})</dd>;
  }

  if (health.status === "invalid") {
    return <dd className="warning">ответил некорректно</dd>;
  }

  return <dd className="error">недоступен</dd>;
}
