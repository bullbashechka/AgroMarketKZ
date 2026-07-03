interface TelegramUser {
  id: number;
  first_name?: string;
  last_name?: string;
  username?: string;
}

type TelegramColorScheme = "light" | "dark";
type TelegramEventName = "themeChanged" | "viewportChanged" | "backButtonClicked";

interface TelegramBackButton {
  isVisible: boolean;
  show: () => void;
  hide: () => void;
  onClick: (cb: () => void) => void;
  offClick: (cb: () => void) => void;
}

interface TelegramWebApp {
  initData: string;
  initDataUnsafe?: { user?: TelegramUser };
  version?: string;
  colorScheme?: TelegramColorScheme;
  themeParams?: Record<string, string>;
  BackButton?: TelegramBackButton;
  ready: () => void;
  expand?: () => void;
  isVersionAtLeast?: (version: string) => boolean;
  onEvent?: (event: TelegramEventName, cb: () => void) => void;
  offEvent?: (event: TelegramEventName, cb: () => void) => void;
  setHeaderColor?: (color: string) => void;
  setBackgroundColor?: (color: string) => void;
  setBottomBarColor?: (color: string) => void;
  enableClosingConfirmation?: () => void;
  disableVerticalSwipes?: () => void;
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

function versionAtLeast(wa: TelegramWebApp, version: string): boolean {
  return wa.isVersionAtLeast?.(version) ?? false;
}

/**
 * Сообщает Telegram, что Mini App готов (убирает лоадер, разворачивает вьюпорт),
 * и включает защиту от случайного закрытия свайпом/кнопкой «назад» системы.
 */
export function initTelegram(): void {
  const wa = getWebApp();
  wa?.ready();
  wa?.expand?.();
  if (!wa) return;
  if (versionAtLeast(wa, "6.2")) wa.enableClosingConfirmation?.();
  if (versionAtLeast(wa, "7.7")) wa.disableVerticalSwipes?.();
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

/** Цветовая схема Telegram-клиента ("light"/"dark"), либо null вне Telegram. */
export function getColorScheme(): TelegramColorScheme | null {
  return getWebApp()?.colorScheme ?? null;
}

/** Подписка на событие Telegram SDK (например, смену темы). No-op вне Telegram. */
export function onTelegramEvent(event: TelegramEventName, cb: () => void): void {
  getWebApp()?.onEvent?.(event, cb);
}

export function offTelegramEvent(event: TelegramEventName, cb: () => void): void {
  getWebApp()?.offEvent?.(event, cb);
}

/**
 * Показывает нативную кнопку «назад» Telegram и вызывает `onClick` при нажатии.
 * Возвращает функцию очистки (снимает обработчик и прячет кнопку) — вызывать в cleanup эффекта.
 * No-op вне Telegram или на старых клиентах (< 6.1).
 */
export function showBackButton(onClick: () => void): () => void {
  const wa = getWebApp();
  if (!wa?.BackButton || !versionAtLeast(wa, "6.1")) return () => {};
  wa.BackButton.onClick(onClick);
  wa.BackButton.show();
  return () => {
    wa.BackButton?.offClick(onClick);
    wa.BackButton?.hide();
  };
}

/**
 * Синхронизирует цвет шапки/фона нативного окна Telegram с текущим фоном темы.
 * No-op вне Telegram или на старых клиентах (< 6.1).
 */
export function setTelegramColors(bgHex: string): void {
  const wa = getWebApp();
  if (!wa || !versionAtLeast(wa, "6.1")) return;
  wa.setHeaderColor?.(bgHex);
  wa.setBackgroundColor?.(bgHex);
  if (versionAtLeast(wa, "7.10")) wa.setBottomBarColor?.(bgHex);
}
