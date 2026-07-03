import { platformSettingsSchema } from "@agromarket/contracts";
import { Hono } from "hono";
import { getEnv, type HonoEnv } from "../env";
import { getSettings } from "../repos/settings";

export const settingsRoutes = new Hono<HonoEnv>();

/** Публичные контакты площадки — без авторизации (нужны и в браузере до входа). */
settingsRoutes.get("/", async (c) => {
  const env = getEnv(c);
  const settings = await getSettings(env);
  return c.json(platformSettingsSchema.parse(settings));
});
