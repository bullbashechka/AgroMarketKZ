import { Hono } from "hono";
import { getEnv, type HonoEnv } from "../../env";
import { requireAdmin } from "../../middleware/admin";
import { requireAuth } from "../../middleware/auth";
import { appendAdminAuditEvent } from "../../repos/adminAudit";
import { adminCardsRoutes } from "./cards";
import { adminCategoriesRoutes } from "./categories";
import { adminRequestsRoutes } from "./requests";
import { adminSettingsRoutes } from "./settings";
import { adminUploadsRoutes } from "./uploads";
import { adminUsersRoutes } from "./users";

export const adminRoutes = new Hono<HonoEnv>();

adminRoutes.use("*", requireAuth, requireAdmin, async (c, next) => {
  await next();
  const path = c.req.path;
  const readsPii = c.req.method === "GET" && (
    path === "/admin/users"
    || path === "/admin/requests"
    || /^\/admin\/requests\/[0-9a-f-]+$/.test(path)
  );
  const mutates = ["POST", "PUT", "PATCH", "DELETE"].includes(c.req.method);
  if (!readsPii && !mutates) return;

  const target = path
    .replace(/^\/admin\//, "")
    .replace(/\/[0-9a-f-]+(?=\/|$)/g, "/:id");
  const targetId = path.match(/[0-9a-f]{8}-[0-9a-f-]{27,}/i)?.[0];
  await appendAdminAuditEvent(getEnv(c), {
    actor: c.get("auth"),
    requestId: c.get("requestId"),
    action: `${c.req.method.toLowerCase()}:${target}`,
    targetType: target.split("/")[0] ?? "admin",
    targetId,
    metadata: { status: c.res.status },
  });
});

adminRoutes.route("/categories", adminCategoriesRoutes);
adminRoutes.route("/cards", adminCardsRoutes);
adminRoutes.route("/uploads", adminUploadsRoutes);
adminRoutes.route("/requests", adminRequestsRoutes);
adminRoutes.route("/users", adminUsersRoutes);
adminRoutes.route("/settings", adminSettingsRoutes);
