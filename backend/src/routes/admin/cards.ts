import {
  adminCardListQuery,
  adminCardListResponse,
  cardDetailSchema,
  createCardInput,
  updateCardInput
} from "@agromarket/contracts";
import { Hono, type Context } from "hono";
import { z } from "zod";
import { getEnv, type HonoEnv } from "../../env";
import { runInBackground } from "../../lib/background";
import { HttpError } from "../../lib/errors";
import { deleteStorageObjects } from "../../lib/storage";
import {
  adminListCards,
  createCard,
  deleteCard,
  setCardArchived,
  updateCard
} from "../../repos/adminCatalog";
import { getCardById } from "../../repos/catalog";

export const adminCardsRoutes = new Hono<HonoEnv>();

function requireCardId(c: Context<HonoEnv>): string {
  const id = z.uuid().safeParse(c.req.param("id"));
  if (!id.success) {
    throw new HttpError(404, "Карточка не найдена");
  }
  return id.data;
}

adminCardsRoutes.get("/", async (c) => {
  const env = getEnv(c);
  const query = adminCardListQuery.parse(c.req.query());
  const result = await adminListCards(env, query);
  return c.json(adminCardListResponse.parse(result));
});

adminCardsRoutes.get("/:id", async (c) => {
  const env = getEnv(c);
  const id = requireCardId(c);
  const card = await getCardById(env, id);
  if (!card) {
    throw new HttpError(404, "Карточка не найдена");
  }
  return c.json(cardDetailSchema.parse(card));
});

adminCardsRoutes.post("/", async (c) => {
  const env = getEnv(c);
  const input = createCardInput.parse(await c.req.json());
  const card = await createCard(env, input);
  return c.json(cardDetailSchema.parse(card), 201);
});

/** Полная замена полей карточки. Удалённые из галереи фото чистятся из Storage после коммита. */
adminCardsRoutes.put("/:id", async (c) => {
  const env = getEnv(c);
  const id = requireCardId(c);
  const input = updateCardInput.parse(await c.req.json());
  const { detail, removedPaths } = await updateCard(env, id, input);
  if (removedPaths.length > 0) {
    runInBackground(c, deleteStorageObjects(env, removedPaths));
  }
  return c.json(cardDetailSchema.parse(detail));
});

/** Удаление карточки. Фото чистятся из Storage best-effort после удаления записи. */
adminCardsRoutes.delete("/:id", async (c) => {
  const env = getEnv(c);
  const id = requireCardId(c);
  const removedPaths = await deleteCard(env, id);
  if (removedPaths.length > 0) {
    runInBackground(c, deleteStorageObjects(env, removedPaths));
  }
  return c.body(null, 204);
});

adminCardsRoutes.post("/:id/archive", async (c) => {
  const env = getEnv(c);
  const id = requireCardId(c);
  await setCardArchived(env, id, true);
  const card = await getCardById(env, id);
  return c.json(cardDetailSchema.parse(card));
});

adminCardsRoutes.post("/:id/unarchive", async (c) => {
  const env = getEnv(c);
  const id = requireCardId(c);
  await setCardArchived(env, id, false);
  const card = await getCardById(env, id);
  return c.json(cardDetailSchema.parse(card));
});
