interface TelegramUser {
  id: number;
  first_name?: string;
  last_name?: string;
  username?: string;
}

interface TelegramWebApp {
  initData: string;
  initDataUnsafe?: { user?: TelegramUser };
  ready: () => void;
  expand?: () => void;
  requestContact?: (callback: (ok: boolean, event?: unknown) => void) => void;
}

declare global {
  interface Window {
    Telegram?: { WebApp?: TelegramWebApp };
  }
}

function getWebApp(): TelegramWebApp | undefined {
  return window.Telegram?.WebApp;
}

/** Сообщает Telegram, что Mini App готов (убирает лоадер, разворачивает вьюпорт). */
export function initTelegram(): void {
  const wa = getWebApp();
  wa?.ready();
  wa?.expand?.();
}

/** Открыто ли приложение внутри Telegram (есть подписанные initData). */
export function isTelegramContext(): boolean {
  return Boolean(getWebApp()?.initData);
}

/** Сырые initData для отправки на backend. */
export function getInitData(): string | null {
  return getWebApp()?.initData || null;
}

/** Имя пользователя из Telegram для предзаполнения формы регистрации. */
export function getTelegramDisplayName(): string {
  const user = getWebApp()?.initDataUnsafe?.user;
  if (!user) return "";
  return [user.first_name, user.last_name].filter(Boolean).join(" ").trim();
}

/**
 * Нативный запрос «Поделиться контактом». Best-effort: если SDK вернёт номер,
 * отдаём его для предзаполнения. Гарантированный путь получения телефона — ручной ввод;
 * полная серверная обработка расшаренного контакта — Этап 8.
 */
export function requestContactPhone(): Promise<string | null> {
  const wa = getWebApp();
  if (!wa?.requestContact) return Promise.resolve(null);
  return new Promise((resolve) => {
    try {
      wa.requestContact!((ok, event) => {
        if (!ok) return resolve(null);
        const phone = (event as { responseUnsafe?: { contact?: { phone_number?: string } } })
          ?.responseUnsafe?.contact?.phone_number;
        resolve(phone ?? null);
      });
    } catch {
      resolve(null);
    }
  });
}
