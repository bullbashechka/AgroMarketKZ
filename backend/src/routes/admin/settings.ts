import { adminPlatformSettingsSchema, updateSettingsInput } from "@agromarket/contracts";
import { Hono } from "hono";
import { getEnv, type HonoEnv } from "../../env";
import { getAdminSettings, updateSettings } from "../../repos/settings";

export const adminSettingsRoutes = new Hono<HonoEnv>();

/** Настройки площадки для админа (включая `adminChatId`). */
adminSettingsRoutes.get("/", async (c) => {
  const env = getEnv(c);
  const settings = await getAdminSettings(env);
  return c.json(adminPlatformSettingsSchema.parse(settings));
});

/** Обновление настроек площадки. Любое поле необязательно, `null` очищает значение. */
adminSettingsRoutes.patch("/", async (c) => {
  const env = getEnv(c);
  const input = updateSettingsInput.parse(await c.req.json());
  const settings = await updateSettings(env, input);
  return c.json(adminPlatformSettingsSchema.parse(settings));
});
