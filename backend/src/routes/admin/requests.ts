import { requestListQuery, requestListResponse, requestSchema, updateRequestStatusInput } from "@agromarket/contracts";
import { Hono } from "hono";
import { z } from "zod";
import { getDatabase, getEnv, type HonoEnv } from "../../env";
import { runAdminMutation } from "../../lib/adminAuditRequest";
import { HttpError } from "../../lib/errors";
import { getRequestById, listRequests, toRequest, updateRequestStatus } from "../../repos/requests";

export const adminRequestsRoutes = new Hono<HonoEnv>();

/** Список заявок, фильтр по статусу. */
adminRequestsRoutes.get("/", async (c) => {
  const env = getEnv(c);
  const query = requestListQuery.parse(c.req.query());
  const result = await listRequests(env, query, getDatabase(c));
  return c.json(requestListResponse.parse(result));
});

/** Заявка по id — деталка для deep-link из Telegram-уведомления. */
adminRequestsRoutes.get("/:id", async (c) => {
  const env = getEnv(c);
  const id = z.uuid().safeParse(c.req.param("id"));
  if (!id.success) {
    throw new HttpError(404, "Заявка не найдена");
  }
  const db = getDatabase(c);
  const row = await getRequestById(env, id.data, db);
  return c.json(requestSchema.parse(await toRequest(env, row, db)));
});

/** Смена статуса заявки. Переходы свободные. */
adminRequestsRoutes.patch("/:id/status", async (c) => {
  const env = getEnv(c);
  const id = z.uuid().safeParse(c.req.param("id"));
  if (!id.success) {
    throw new HttpError(404, "Заявка не найдена");
  }
  const { status } = updateRequestStatusInput.parse(await c.req.json());
  const db = getDatabase(c);
  const row = await runAdminMutation(c, 200, (audit) => updateRequestStatus(env, id.data, status, db, audit));
  return c.json(requestSchema.parse(await toRequest(env, row, db)));
});
