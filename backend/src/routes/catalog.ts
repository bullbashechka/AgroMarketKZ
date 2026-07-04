import {
  cardDetailSchema,
  cardListQuery,
  cardListResponse,
  categoryListItemResponse,
  categoryListQuery
} from "@agromarket/contracts";
import { Hono } from "hono";
import { z } from "zod";
import { getEnv, type HonoEnv } from "../env";
import { HttpError } from "../lib/errors";
import { requireAuth } from "../middleware/auth";
import { requireRegistered } from "../middleware/registered";
import { getCardById, listCards, listCategories } from "../repos/catalog";

export const catalogRoutes = new Hono<HonoEnv>();

// Каталог закрыт от парсеров: доступен только авторизованным зарегистрированным пользователям.
catalogRoutes.use("*", requireAuth, requireRegistered);

/** Категории вкладки с числом карточек; пустые категории скрыты от пользователей. */
catalogRoutes.get("/categories", async (c) => {
  const env = getEnv(c);
  const { type } = categoryListQuery.parse(c.req.query());
  const categories = await listCategories(env, type);
  return c.json(categoryListItemResponse.parse(categories));
});

/** Карточки вкладки с фильтрами и постраничной выдачей (load-more). Архив не попадает. */
catalogRoutes.get("/cards", async (c) => {
  const env = getEnv(c);
  const query = cardListQuery.parse(c.req.query());
  const result = await listCards(env, query);
  return c.json(cardListResponse.parse(result));
});

/** Карточка по id, включая архивные — фронт покажет заглушку «снято с публикации». */
catalogRoutes.get("/cards/:id", async (c) => {
  const env = getEnv(c);
  const id = z.uuid().safeParse(c.req.param("id"));
  if (!id.success) {
    throw new HttpError(404, "Карточка не найдена");
  }
  const card = await getCardById(env, id.data);
  if (!card) {
    throw new HttpError(404, "Карточка не найдена");
  }
  return c.json(cardDetailSchema.parse(card));
});
