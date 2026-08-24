import { Hono } from "hono";
import type { HonoEnv } from "../../env";
import { requireAdmin } from "../../middleware/admin";
import { requireAuth } from "../../middleware/auth";
import { adminCardsRoutes } from "./cards";
import { adminCategoriesRoutes } from "./categories";
import { adminE2eRoutes } from "./e2e";
import { adminRequestsRoutes } from "./requests";
import { adminSettingsRoutes } from "./settings";
import { adminUploadsRoutes } from "./uploads";
import { adminUsersRoutes } from "./users";

export const adminRoutes = new Hono<HonoEnv>();

adminRoutes.use("*", requireAuth, requireAdmin);

adminRoutes.route("/categories", adminCategoriesRoutes);
adminRoutes.route("/e2e", adminE2eRoutes);
adminRoutes.route("/cards", adminCardsRoutes);
adminRoutes.route("/uploads", adminUploadsRoutes);
adminRoutes.route("/requests", adminRequestsRoutes);
adminRoutes.route("/users", adminUsersRoutes);
adminRoutes.route("/settings", adminSettingsRoutes);
