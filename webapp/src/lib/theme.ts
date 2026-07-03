import { getColorScheme, isTelegramContext, onTelegramEvent, setTelegramColors } from "./telegram";

type Scheme = "light" | "dark";

const darkMediaQuery = () => window.matchMedia("(prefers-color-scheme: dark)");

function resolveScheme(): Scheme {
  // telegram-web-app.js создаёт window.Telegram.WebApp как заглушку и вне настоящего Telegram
  // (для плавной деградации), и её colorScheme там всегда "light" — доверяем ей только
  // при реальном запуске внутри Telegram (есть подписанные initData).
  if (isTelegramContext()) {
    const tgScheme = getColorScheme();
    if (tgScheme) return tgScheme;
  }
  return darkMediaQuery().matches ? "dark" : "light";
}

/** Применяет тему к документу и синхронизирует цвет шапки/фона нативного окна Telegram. */
function applyTheme(scheme: Scheme): void {
  document.documentElement.dataset.theme = scheme;
  const bg = getComputedStyle(document.documentElement).getPropertyValue("--color-bg").trim();
  if (bg) setTelegramColors(bg);
}

/**
 * Включает автоматическую синхронизацию темы: в Telegram — по `colorScheme`/`themeChanged`,
 * в браузере — по `prefers-color-scheme`. Вызвать один раз при старте приложения.
 */
export function initThemeSync(): void {
  applyTheme(resolveScheme());

  if (isTelegramContext()) {
    const onThemeChanged = () => applyTheme(resolveScheme());
    onTelegramEvent("themeChanged", onThemeChanged);
    return;
  }

  const mq = darkMediaQuery();
  const onChange = () => applyTheme(resolveScheme());
  mq.addEventListener("change", onChange);
}
