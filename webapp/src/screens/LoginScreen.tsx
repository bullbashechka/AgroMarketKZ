import type { WidgetLoginInput } from "@agromarket/contracts";
import { useEffect, useRef } from "react";
import { useAuth } from "../lib/auth";

const BOT_USERNAME = import.meta.env.VITE_TELEGRAM_BOT_USERNAME as string | undefined;

/** Поля, которые Telegram Login Widget добавляет в query string при `data-auth-url` redirect. */
function parseWidgetRedirect(search: string): WidgetLoginInput | null {
  const params = new URLSearchParams(search);
  const hash = params.get("hash");
  const id = params.get("id");
  const authDate = params.get("auth_date");
  const firstName = params.get("first_name");
  if (!hash || !id || !authDate || !firstName) return null;
  return {
    id: Number(id),
    first_name: firstName,
    last_name: params.get("last_name") ?? undefined,
    username: params.get("username") ?? undefined,
    photo_url: params.get("photo_url") ?? undefined,
    auth_date: Number(authDate),
    hash
  };
}

/**
 * Вход в обычном браузере через Telegram Login Widget. Использует `data-auth-url` (браузер
 * получает redirect с данными в query string), а не `data-onauth`: JS-колбэк `data-onauth`
 * вызывается виджетом через `eval()`, что потребовало бы `unsafe-eval` в CSP `script-src`.
 * Redirect-вариант этого не требует.
 */
export function LoginScreen() {
  const { loginWidget, loginPending, loginError } = useAuth();
  const containerRef = useRef<HTMLDivElement>(null);
  const handledRedirect = useRef(false);

  // Однократно разбираем query string на случай, если это и есть redirect от Telegram.
  useEffect(() => {
    if (handledRedirect.current) return;
    handledRedirect.current = true;
    const parsed = parseWidgetRedirect(window.location.search);
    if (parsed) {
      // Remove the signed Telegram payload before any asynchronous network
      // work. The URL is otherwise copied into history, referrers or screenshots.
      window.history.replaceState(null, "", window.location.pathname);
      loginWidget(parsed);
    }
  }, [loginWidget]);

  useEffect(() => {
    const container = containerRef.current;
    if (!BOT_USERNAME || !container) return;

    // Возвращаем на тот же путь; кроме "/" — там beforeLoad-редирект на /products сотрёт
    // query string раньше, чем страница успеет её прочитать.
    const returnPath = window.location.pathname === "/" ? "/products" : window.location.pathname;

    const script = document.createElement("script");
    script.src = "https://telegram.org/js/telegram-widget.js?22";
    script.async = true;
    script.setAttribute("data-telegram-login", BOT_USERNAME);
    script.setAttribute("data-size", "large");
    script.setAttribute("data-userpic", "false");
    script.setAttribute("data-request-access", "write");
    script.setAttribute("data-auth-url", `${window.location.origin}${returnPath}`);
    container.appendChild(script);
  }, []);

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
        {loginError && (
          <p className="field-error" role="alert">
            {loginError} Попробуйте войти через кнопку Telegram ещё раз.
          </p>
        )}
      </section>
    </main>
  );
}
