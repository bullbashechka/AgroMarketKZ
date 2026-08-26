import { adminPlatformSettingsSchema, updateSettingsInput } from "@agromarket/contracts";
import { Hono } from "hono";
import { getDatabase, getEnv, type HonoEnv } from "../../env";
import { runAdminMutation } from "../../lib/adminAuditRequest";
import { HttpError } from "../../lib/errors";
import { getAdminSettings, updateSettings } from "../../repos/settings";

export const adminSettingsRoutes = new Hono<HonoEnv>();

/** Настройки площадки для админа (включая `adminChatId`). */
adminSettingsRoutes.get("/", async (c) => {
  const env = getEnv(c);
  const settings = await getAdminSettings(env, getDatabase(c));
  return c.json(adminPlatformSettingsSchema.parse(settings));
});

/** Обновление настроек площадки. Любое поле необязательно, `null` очищает значение. */
adminSettingsRoutes.patch("/", async (c) => {
  const env = getEnv(c);
  const input = updateSettingsInput.parse(await c.req.json());
  if ("adminChatId" in input) {
    const ownerTelegramId = Number(env.ADMIN_OWNER_TELEGRAM_ID);
    if (!Number.isSafeInteger(ownerTelegramId) || c.get("auth").telegramId !== ownerTelegramId) {
      throw new HttpError(403, "Только владелец может менять чат уведомлений");
    }
  }
  const settings = await runAdminMutation(c, 200, (audit) => updateSettings(env, input, getDatabase(c), audit));
  return c.json(adminPlatformSettingsSchema.parse(settings));
});
