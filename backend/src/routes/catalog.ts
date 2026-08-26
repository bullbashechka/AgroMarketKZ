import {
  cardDetailSchema,
  cardListQuery,
  cardListResponse,
  categoryListItemResponse,
  categoryListQuery,
  territoryListResponse
} from "@agromarket/contracts";
import { Hono } from "hono";
import { z } from "zod";
import { getDatabase, getEnv, type HonoEnv } from "../env";
import { HttpError } from "../lib/errors";
import { requireAuth } from "../middleware/auth";
import { getCardById, listCards, listCategories, listTerritories } from "../repos/catalog";

export const catalogRoutes = new Hono<HonoEnv>();

// Каталог закрыт от парсеров, но доступен сразу после Telegram-авторизации — до сбора телефона.
catalogRoutes.use("*", requireAuth);

/** Категории вкладки с числом карточек; пустые категории скрыты от пользователей. */
catalogRoutes.get("/categories", async (c) => {
  const env = getEnv(c);
  const { type, includeEmpty } = categoryListQuery.parse(c.req.query());
  const categories = await listCategories(env, type, getDatabase(c), includeEmpty);
  return c.json(categoryListItemResponse.parse(categories));
});

/** Точные территории для пользовательского фильтра и форм. */
catalogRoutes.get("/territories", async (c) => {
  const env = getEnv(c);
  return c.json(territoryListResponse.parse(await listTerritories(env, getDatabase(c))));
});

/** Карточки вкладки с фильтрами и постраничной выдачей (load-more). Архив не попадает. */
catalogRoutes.get("/cards", async (c) => {
  const env = getEnv(c);
  const query = cardListQuery.parse(c.req.query());
  const result = await listCards(env, query, getDatabase(c));
  return c.json(cardListResponse.parse(result));
});

/** Публичная карточка по id; архивные и черновики отвечают 404. */
catalogRoutes.get("/cards/:id", async (c) => {
  const env = getEnv(c);
  const id = z.uuid().safeParse(c.req.param("id"));
  if (!id.success) {
    throw new HttpError(404, "Карточка не найдена");
  }
  const card = await getCardById(env, id.data, getDatabase(c));
  if (!card) {
    throw new HttpError(404, "Карточка не найдена");
  }
  return c.json(cardDetailSchema.parse(card));
});
