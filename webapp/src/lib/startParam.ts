import type { router as appRouter } from "../router";
import { getStartParam } from "./telegram";

const HANDLED_KEY = "startParamHandled";

/**
 * Одноразовая обработка deep-link `startapp` (t.me/<бот>/<приложение>?startapp=…).
 * Поддерживаемый формат: `request_<uuid>` → деталка заявки в админке (у не-админа
 * AdminGuard уведёт в каталог). Параметр живёт в initData всю сессию Mini App,
 * поэтому обработанное значение запоминается в sessionStorage — перезагрузка
 * страницы внутри той же сессии не вызывает повторный редирект.
 */
export function consumeStartParam(router: typeof appRouter): void {
  const param = getStartParam();
  if (!param) return;

  try {
    if (sessionStorage.getItem(HANDLED_KEY) === param) return;
    sessionStorage.setItem(HANDLED_KEY, param);
  } catch {
    // sessionStorage недоступен — обработаем без защиты от повтора.
  }

  const match = /^request_([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i.exec(param);
  if (!match) return;

  router.navigate({ to: "/admin/requests/$requestId", params: { requestId: match[1]! } });
}
