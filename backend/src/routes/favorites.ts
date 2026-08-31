import { favoriteInput, favoriteMembershipQuery, favoriteMembershipResponse, favoritesPageQuery, favoritesResponse } from "@agromarket/contracts";
import { Hono } from "hono";
import { z } from "zod";
import { getDatabase, getEnv, type HonoEnv } from "../env";
import { requireAuth } from "../middleware/auth";
import { requireRegistered } from "../middleware/registered";
import { addFavorite, listFavoriteIds, listFavorites, removeFavorite } from "../repos/favorites";

export const favoritesRoutes = new Hono<HonoEnv>();

favoritesRoutes.use("*", requireAuth, requireRegistered);

/** Список избранного текущего пользователя. */
favoritesRoutes.get("/", async (c) => {
  const env = getEnv(c);
  const { userId } = c.get("auth");
  if (c.req.query("pagination") !== "cursor") {
    const items = [];
    let cursor: string | undefined;
    do {
      const page = await listFavorites(env, userId, { pagination: "cursor", limit: 50, cursor }, getDatabase(c));
      items.push(...page.items);
      cursor = page.nextCursor ?? undefined;
    } while (cursor);
    return c.json(items);
  }
  const page = favoritesPageQuery.parse(c.req.query());
  return c.json(favoritesResponse.parse(await listFavorites(env, userId, page, getDatabase(c))));
});

favoritesRoutes.get("/membership", async (c) => {
  const query = favoriteMembershipQuery.parse(c.req.query());
  return c.json(favoriteMembershipResponse.parse({
    favoriteIds: await listFavoriteIds(c.get("auth").userId, query, getDatabase(c)),
  }));
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
