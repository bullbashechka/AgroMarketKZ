import { favoriteInput, favoritesResponse } from "@agromarket/contracts";
import { Hono } from "hono";
import { z } from "zod";
import { getDatabase, getEnv, type HonoEnv } from "../env";
import { requireAuth } from "../middleware/auth";
import { requireRegistered } from "../middleware/registered";
import { addFavorite, listFavorites, removeFavorite } from "../repos/favorites";

export const favoritesRoutes = new Hono<HonoEnv>();

favoritesRoutes.use("*", requireAuth, requireRegistered);

/** Список избранного текущего пользователя. */
favoritesRoutes.get("/", async (c) => {
  const env = getEnv(c);
  const { userId } = c.get("auth");
  const items = await listFavorites(env, userId, getDatabase(c));
  return c.json(favoritesResponse.parse(items));
});

/** Добавление карточки в избранное. Идемпотентно. */
favoritesRoutes.post("/", async (c) => {
  const env = getEnv(c);
  const { userId } = c.get("auth");
  const { cardId } = favoriteInput.parse(await c.req.json());
  await addFavorite(env, userId, cardId, getDatabase(c));
  return c.body(null, 204);
});

/** Удаление карточки из избранного. Идемпотентно — повторный вызов тоже 204. */
favoritesRoutes.delete("/:cardId", async (c) => {
  const env = getEnv(c);
  const { userId } = c.get("auth");
  const cardId = z.uuid().safeParse(c.req.param("cardId"));
  if (cardId.success) {
    await removeFavorite(env, userId, cardId.data, getDatabase(c));
  }
  return c.body(null, 204);
});
