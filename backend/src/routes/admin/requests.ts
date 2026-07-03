import { requestListQuery, requestListResponse, requestSchema, updateRequestStatusInput } from "@agromarket/contracts";
import { Hono } from "hono";
import { z } from "zod";
import { getEnv, type HonoEnv } from "../../env";
import { HttpError } from "../../lib/errors";
import { listRequests, toRequest, updateRequestStatus } from "../../repos/requests";

export const adminRequestsRoutes = new Hono<HonoEnv>();

/** Список заявок, фильтр по статусу. */
adminRequestsRoutes.get("/", async (c) => {
  const env = getEnv(c);
  const query = requestListQuery.parse(c.req.query());
  const result = await listRequests(env, query);
  return c.json(requestListResponse.parse(result));
});

/** Смена статуса заявки. Переходы свободные. */
adminRequestsRoutes.patch("/:id/status", async (c) => {
  const env = getEnv(c);
  const id = z.uuid().safeParse(c.req.param("id"));
  if (!id.success) {
    throw new HttpError(404, "Заявка не найдена");
  }
  const { status } = updateRequestStatusInput.parse(await c.req.json());
  const row = await updateRequestStatus(env, id.data, status);
  return c.json(requestSchema.parse(toRequest(row)));
});
