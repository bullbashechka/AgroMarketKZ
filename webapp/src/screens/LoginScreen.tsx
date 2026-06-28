import type { WidgetLoginInput } from "@agromarket/contracts";
import { useEffect, useRef } from "react";
import { useAuth } from "../lib/auth";

const BOT_USERNAME = import.meta.env.VITE_TELEGRAM_BOT_USERNAME as string | undefined;

/** Вход в обычном браузере через Telegram Login Widget. */
export function LoginScreen() {
  const { loginWidget, loginPending } = useAuth();
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // Колбэк, который дёргает виджет после успешного входа.
    (window as unknown as { onTelegramAuth?: (u: WidgetLoginInput) => void }).onTelegramAuth = (
      user
    ) => loginWidget(user);

    const container = containerRef.current;
    if (!BOT_USERNAME || !container) return;

    const script = document.createElement("script");
    script.src = "https://telegram.org/js/telegram-widget.js?22";
    script.async = true;
    script.setAttribute("data-telegram-login", BOT_USERNAME);
    script.setAttribute("data-size", "large");
    script.setAttribute("data-userpic", "false");
    script.setAttribute("data-request-access", "write");
    script.setAttribute("data-onauth", "onTelegramAuth(user)");
    container.appendChild(script);

    return () => {
      delete (window as unknown as { onTelegramAuth?: unknown }).onTelegramAuth;
    };
  }, [loginWidget]);

  return (
    <main className="shell">
      <section className="card">
        <p className="eyebrow">Вход</p>
        <h1>AgroMarketKZ</h1>
        <p className="description">Войдите через Telegram, чтобы продолжить.</p>

        {!BOT_USERNAME ? (
          <p className="field-error">
            Не задан <code>VITE_TELEGRAM_BOT_USERNAME</code> — кнопка входа недоступна.
          </p>
        ) : (
          <div ref={containerRef} className="tg-widget" />
        )}

        {loginPending && <p className="muted">Входим…</p>}
      </section>
    </main>
  );
}
