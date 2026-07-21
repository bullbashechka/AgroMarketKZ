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

type HapticNotificationType = "error" | "success" | "warning";
type HapticImpactStyle = "light" | "medium" | "heavy" | "rigid" | "soft";

interface TelegramHapticFeedback {
  impactOccurred: (style: HapticImpactStyle) => void;
  notificationOccurred: (type: HapticNotificationType) => void;
  selectionChanged: () => void;
}

/** Событие requestContact: `response` — подписанная строка для серверной проверки. */
interface TelegramContactEvent {
  status?: string;
  response?: string;
  responseUnsafe?: { contact?: { phone_number?: string } };
}

interface TelegramWebApp {
  initData: string;
  initDataUnsafe?: { user?: TelegramUser; start_param?: string };
  version?: string;
  colorScheme?: TelegramColorScheme;
  themeParams?: Record<string, string>;
  BackButton?: TelegramBackButton;
  HapticFeedback?: TelegramHapticFeedback;
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
  requestContact?: (callback: (ok: boolean, event?: TelegramContactEvent) => void) => void;
  openLink?: (url: string, options?: { try_instant_view?: boolean }) => void;
  openTelegramLink?: (url: string) => void;
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

/** Результат «Поделиться контактом»: подписанная строка + номер без проверки. */
export interface SharedContact {
  /** Подписанный ответ Telegram для серверной верификации (может отсутствовать на старых клиентах). */
  response: string | null;
  /** Телефон из неподписанной копии — fallback для предзаполнения без верификации. */
  unsafePhone: string | null;
}

/**
 * Нативный запрос «Поделиться контактом». Возвращает `null` при отказе или вне
 * Telegram. Гарантированный путь получения телефона — ручной ввод в форме.
 */
export function requestTelegramContact(): Promise<SharedContact | null> {
  const wa = getWebApp();
  if (!wa?.requestContact) return Promise.resolve(null);
  return new Promise((resolve) => {
    try {
      wa.requestContact!((ok, event) => {
        if (!ok) return resolve(null);
        resolve({
          response: event?.response ?? null,
          unsafePhone: event?.responseUnsafe?.contact?.phone_number ?? null
        });
      });
    } catch {
      resolve(null);
    }
  });
}

/** Параметр `startapp` из deep-link (t.me/<бот>/<приложение>?startapp=…), либо null. */
export function getStartParam(): string | null {
  return getWebApp()?.initDataUnsafe?.start_param ?? null;
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

/** Тактильный отклик на успех/ошибку (например, отправка заявки). No-op вне Telegram. */
export function hapticNotify(type: HapticNotificationType): void {
  getWebApp()?.HapticFeedback?.notificationOccurred(type);
}

/** Лёгкий тактильный отклик на короткое действие (например, тап по сердечку). No-op вне Telegram. */
export function hapticImpactLight(): void {
  getWebApp()?.HapticFeedback?.impactOccurred("light");
}

const ALLOWED_EXTERNAL_SCHEMES = ["tel:", "mailto:", "https:"];

/**
 * Открывает внешнюю ссылку (звонок/WhatsApp и т.п.). В Telegram — через SDK (не покидая клиент
 * там, где это возможно), вне Telegram — обычным способом браузера.
 * Отклоняет схемы вне allowlist (`javascript:`, `data:`, `http:` и т.п.) — защита от произвольного
 * URL, даже если он случайно дойдёт сюда из недостаточно провалидированных данных.
 */
export function openExternalLink(url: string): void {
  if (!ALLOWED_EXTERNAL_SCHEMES.some((scheme) => url.startsWith(scheme))) {
    console.warn(`openExternalLink: запрещённая схема — ${url}`);
    return;
  }
  const wa = getWebApp();
  if (wa?.openLink) {
    wa.openLink(url);
    return;
  }
  window.open(url, "_blank", "noopener,noreferrer");
}

/** Открывает t.me-ссылку на Telegram-аккаунт/канал. No-op-фолбэк вне Telegram — обычная ссылка. */
export function openTelegramDeepLink(url: string): void {
  if (!/^https:\/\/t\.me\//i.test(url)) {
    console.warn(`openTelegramDeepLink: не t.me-ссылка — ${url}`);
    return;
  }
  const wa = getWebApp();
  if (wa?.openTelegramLink) {
    wa.openTelegramLink(url);
    return;
  }
  window.open(url, "_blank", "noopener,noreferrer");
}
