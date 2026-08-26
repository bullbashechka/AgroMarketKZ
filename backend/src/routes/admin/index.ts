import { Hono } from "hono";
import { ZodError } from "zod";
import { isConnectionError } from "../../db";
import type { HonoEnv } from "../../env";
import { HttpError } from "../../lib/errors";
import { auditAdminRequest } from "../../lib/adminAuditRequest";
import { requireAdmin } from "../../middleware/admin";
import { requireAuth } from "../../middleware/auth";
import { adminCardsRoutes } from "./cards";
import { adminCategoriesRoutes } from "./categories";
import { adminRequestsRoutes } from "./requests";
import { adminSettingsRoutes } from "./settings";
import { adminUploadsRoutes } from "./uploads";
import { adminUsersRoutes } from "./users";

export const adminRoutes = new Hono<HonoEnv>();

function errorStatus(error: unknown): number {
  if (error instanceof HttpError) return error.status;
  if (error instanceof ZodError) return 400;
  if (isConnectionError(error)) return 503;
  return 500;
}

adminRoutes.use("*", async (c, next) => {
  c.set("adminAuditCommitted", false);
  try {
    await next();
  } catch (error) {
    if (!c.get("adminAuditCommitted")) await auditAdminRequest(c, errorStatus(error));
    throw error;
  }
  if (!c.get("adminAuditCommitted")) await auditAdminRequest(c, c.res.status);
});

adminRoutes.use("*", requireAuth, requireAdmin);

adminRoutes.route("/categories", adminCategoriesRoutes);
adminRoutes.route("/cards", adminCardsRoutes);
adminRoutes.route("/uploads", adminUploadsRoutes);
adminRoutes.route("/requests", adminRequestsRoutes);
adminRoutes.route("/users", adminUsersRoutes);
adminRoutes.route("/settings", adminSettingsRoutes);
