import {
  adminCardListQuery,
  adminCardListResponse,
  adminCardDetailSchema,
  cardVersionInput,
  createCardInput,
  updateCardInput
} from "@agromarket/contracts";
import { Hono, type Context } from "hono";
import { z } from "zod";
import { getDatabase, getEnv, type HonoEnv } from "../../env";
import { runAdminMutation } from "../../lib/adminAuditRequest";
import { runInBackground } from "../../lib/background";
import { HttpError } from "../../lib/errors";
import { deleteStorageObjects } from "../../lib/storage";
import { findReferencedStoragePaths } from "../../repos/cardImages";
import {
  adminListCards,
  archiveCard,
  createCard,
  deleteCard,
  getAdminCardDetail,
  getAdminCardDetailForMutation,
  publishCard,
  updateCard
} from "../../repos/adminCatalog";

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
  const result = await adminListCards(env, query, getDatabase(c));
  return c.json(adminCardListResponse.parse(result));
});

adminCardsRoutes.get("/:id", async (c) => {
  const env = getEnv(c);
  const id = requireCardId(c);
  const mutationId = c.req.query("mutationId");
  const db = getDatabase(c);
  if (mutationId !== undefined && !z.uuid().safeParse(mutationId).success) {
    throw new HttpError(400, "Некорректный идентификатор изменения");
  }
  const card = mutationId === undefined
    ? await getAdminCardDetail(env, id, db)
    : await getAdminCardDetailForMutation(env, id, mutationId, db);
  if (!card) {
    if (mutationId !== undefined) {
      throw new HttpError(409, "Изменение с указанным идентификатором не найдено", {
        code: "CARD_UPDATE_MUTATION_NOT_FOUND",
      });
    }
    throw new HttpError(404, "Карточка не найдена");
  }
  return c.json(adminCardDetailSchema.parse(card));
});

adminCardsRoutes.post("/", async (c) => {
  const env = getEnv(c);
  const input = createCardInput.parse(await c.req.json());
  const card = await runAdminMutation(c, 201, (audit) => createCard(
    env,
    input,
    getDatabase(c),
    { actorUserId: c.get("auth").userId, audit },
  ));
  return c.json(adminCardDetailSchema.parse(card), 201);
});

/** Полная замена полей карточки. Удалённые из галереи фото чистятся из Storage после коммита. */
adminCardsRoutes.put("/:id", async (c) => {
  const env = getEnv(c);
  const id = requireCardId(c);
  const input = updateCardInput.parse(await c.req.json());
  const db = getDatabase(c);
  const { detail, removedPaths } = await runAdminMutation(c, 200, (audit) => updateCard(
    env,
    id,
    input,
    db,
    { actorUserId: c.get("auth").userId, audit },
  ));
  if (removedPaths.length > 0) {
    runInBackground(c, (async () => {
      const referenced = await findReferencedStoragePaths(env, removedPaths, db);
      await deleteStorageObjects(env, removedPaths.filter((path) => !referenced.has(path)));
    })());
  }
  return c.json(adminCardDetailSchema.parse(detail));
});

/** Удаление карточки. Фото чистятся из Storage best-effort после удаления записи. */
adminCardsRoutes.delete("/:id", async (c) => {
  const env = getEnv(c);
  const id = requireCardId(c);
  const { expectedVersion } = cardVersionInput.parse(await c.req.json());
  const db = getDatabase(c);
  const removedPaths = await runAdminMutation(c, 204, (audit) => deleteCard(env, id, expectedVersion, db, audit));
  if (removedPaths.length > 0) {
    runInBackground(c, (async () => {
      const referenced = await findReferencedStoragePaths(env, removedPaths, db);
      await deleteStorageObjects(env, removedPaths.filter((path) => !referenced.has(path)));
    })());
  }
  return c.body(null, 204);
});

adminCardsRoutes.post("/:id/archive", async (c) => {
  const env = getEnv(c);
  const id = requireCardId(c);
  const { expectedVersion } = cardVersionInput.parse(await c.req.json());
  const card = await runAdminMutation(c, 200, (audit) => archiveCard(env, id, expectedVersion, getDatabase(c), audit));
  return c.json(adminCardDetailSchema.parse(card));
});

adminCardsRoutes.post("/:id/publish", async (c) => {
  const env = getEnv(c);
  const id = requireCardId(c);
  const { expectedVersion } = cardVersionInput.parse(await c.req.json());
  const card = await runAdminMutation(c, 200, (audit) => publishCard(env, id, expectedVersion, getDatabase(c), audit));
  return c.json(adminCardDetailSchema.parse(card));
});

// Совместимость старых клиентов: повторное открытие теперь проходит ту же проверку публикации.
adminCardsRoutes.post("/:id/unarchive", async (c) => {
  const env = getEnv(c);
  const id = requireCardId(c);
  const { expectedVersion } = cardVersionInput.parse(await c.req.json());
  const card = await runAdminMutation(c, 200, (audit) => publishCard(env, id, expectedVersion, getDatabase(c), audit));
  return c.json(adminCardDetailSchema.parse(card));
});
