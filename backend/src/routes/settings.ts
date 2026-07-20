import { contactCapabilitiesSchema, platformSettingsSchema } from "@agromarket/contracts";
import { Hono } from "hono";
import { getEnv, type HonoEnv } from "../env";
import { requireAuth } from "../middleware/auth";
import { requireRegistered } from "../middleware/registered";
import { getContactCapabilities, getSettings } from "../repos/settings";

export const settingsRoutes = new Hono<HonoEnv>();

settingsRoutes.use("*", requireAuth);

/** Гость видит доступные варианты, но не получает телефоны и ссылки. */
settingsRoutes.get("/capabilities", async (c) => {
  const capabilities = await getContactCapabilities(getEnv(c));
  return c.json(contactCapabilitiesSchema.parse(capabilities));
});

/** Полные контакты раскрываются только после регистрации. */
settingsRoutes.get("/", requireRegistered, async (c) => {
  const env = getEnv(c);
  const settings = await getSettings(env);
  return c.json(platformSettingsSchema.parse(settings));
});
