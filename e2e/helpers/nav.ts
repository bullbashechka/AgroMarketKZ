import type { Page } from "@playwright/test";

/**
 * Vite dev-прокси форвардит `/admin/*` на backend API (см. webapp/vite.config.ts), поэтому
 * `page.goto("/admin/...")` в dev-режиме возвращает JSON бэкенда, а не SPA. Переходим на
 * безопасный корень («Общее», не проксируется) и кликаем по ссылке — обычная клиентская
 * навигация роутера, без полного HTTP-запроса к /admin/*.
 */
export async function gotoAdminSection(page: Page, href: string) {
  await page.goto("/general");
  await page.getByTestId(`general-link-${href}`).click();
}
