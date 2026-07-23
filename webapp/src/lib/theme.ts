import { setTelegramColors } from "./telegram";

/**
 * Приложение всегда светлое (тёмная тема отключена намеренно) — синхронизируем только цвет
 * шапки/фона нативного окна Telegram под наш светлый `--color-bg`, без слежения за системной
 * темой устройства.
 */
export function initThemeSync(): void {
  const bg = getComputedStyle(document.documentElement).getPropertyValue("--color-bg").trim();
  if (bg) setTelegramColors(bg);
}
