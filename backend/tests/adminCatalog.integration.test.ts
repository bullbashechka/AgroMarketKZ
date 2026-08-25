import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import postgres from "postgres";
import type { AppEnv } from "../src/env";
import { closeDb } from "../src/db";
import {
  createCard,
  getAdminCardDetail,
  getAdminCardDetailForMutation,
  publishCard,
  updateCard,
  updateCategory,
} from "../src/repos/adminCatalog";
import { cleanupE2eRun } from "../src/repos/e2eCleanup";

const databaseUrl = process.env.TEST_DATABASE_URL;
const describeIntegration = databaseUrl ? describe : describe.skip;

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

const env: AppEnv = {
  WEBAPP_ORIGIN: "http://127.0.0.1:5173",
  JWT_SECRET: "integration-only-jwt-secret",
  TELEGRAM_BOT_TOKEN: "integration-only-bot-token",
  ADMIN_ALLOWLIST: "",
  DATABASE_URL: databaseUrl ?? "postgresql://127.0.0.1:1/disabled",
  SUPABASE_URL: "https://integration-only.invalid",
  SUPABASE_STORAGE_BUCKET: "card-images",
  SUPABASE_SERVICE_ROLE_KEY: "integration-only-service-role-key",
};

describeIntegration("admin catalog persistence", () => {
  const sql = postgres(env.DATABASE_URL, { prepare: false, max: 1 });
  const realFetch = globalThis.fetch;
  let categoryId: string;

  beforeEach(() => {
    globalThis.fetch = (async (input, init) => {
      if (init?.method === "POST" && String(input).includes("/storage/v1/object/list/")) {
        return Response.json([]);
      }
      return realFetch(input, init);
    }) as typeof fetch;
  });

  beforeAll(async () => {
    categoryId = crypto.randomUUID();
    await sql`
      insert into categories (id, type, name, sort_order, is_commodity, required_specs)
      values (${categoryId}, 'product', ${`[integration] ${categoryId}`}, 0, true, ${["Год выпуска"]})
    `;
  });

  afterAll(async () => {
    globalThis.fetch = realFetch;
    await closeDb();
    await sql`delete from cards where category_id = ${categoryId}`;
    await sql`delete from categories where id = ${categoryId}`;
    await sql.end({ timeout: 0 });
  });

  test("создаёт черновик, сохраняет фото и данные, затем публикует", async () => {
    const created = await createCard(env, {
      type: "product",
      categoryId,
      title: "Интеграционная карточка",
      description: "Описание до публикации",
      priceType: "fixed",
      priceAmount: 1000,
      priceUnit: null,
      priceReason: null,
      location: null,
      territoryCode: "abay_region",
      ownershipForm: "peasant_farm",
      productLocation: "elevator",
      productLocationDetail: null,
      serviceAllKazakhstan: false,
      serviceTerritoryCodes: [],
      availability: null,
      sortOrder: 0,
      images: [],
      specs: [],
    });

    expect(created.publicationStatus).toBe("draft");
    expect(created.reviewIssues).toEqual(expect.arrayContaining([
      "Добавьте хотя бы одно фото",
      "Выберите группу продукции",
      "Укажите объём в тоннах",
      "Укажите единицу цены",
      "Заполните характеристику «Год выпуска»",
    ]));

    const updated = await updateCard(env, created.id, {
      type: "product",
      categoryId,
      title: created.title,
      description: created.description,
      priceType: "fixed",
      priceAmount: 1000,
      priceUnit: "за тонну",
      priceReason: null,
      location: null,
      territoryCode: "abay_region",
      ownershipForm: "peasant_farm",
      productLocation: "elevator",
      productLocationDetail: null,
      commodityGroup: "cereals",
      volumeTonnes: 120.5,
      serviceAllKazakhstan: false,
      serviceTerritoryCodes: [],
      availability: null,
      sortOrder: 0,
      images: [{ storagePath: "cards/11111111-1111-4111-8111-111111111111.jpg", sortOrder: 0 }],
      specs: [{ key: "Год выпуска", value: "2026", sortOrder: 0 }],
      expectedVersion: created.version,
    });

    expect(updated.detail.reviewIssues).toEqual([]);
    expect(updated.detail.images.map((image) => image.storagePath)).toEqual(["cards/11111111-1111-4111-8111-111111111111.jpg"]);
    expect(updated.detail.version).toBe(created.version + 1);

    const published = await publishCard(env, created.id, updated.detail.version);
    expect(published.publicationStatus).toBe("published");
    expect(published.reviewIssues).toEqual([]);
  });

  test("constraint duplicate image возвращается как понятная ошибка", async () => {
    const card = await createCard(env, {
      type: "product",
      categoryId,
      title: "Карточка с дублем фото",
      description: "Описание",
      priceType: "fixed",
      priceAmount: 1000,
      priceUnit: null,
      priceReason: null,
      location: null,
      territoryCode: "abay_region",
      ownershipForm: "peasant_farm",
      productLocation: "elevator",
      productLocationDetail: null,
      serviceAllKazakhstan: false,
      serviceTerritoryCodes: [],
      availability: null,
      sortOrder: 0,
      images: [],
      specs: [],
    });

    await expect(updateCard(env, card.id, {
      type: "product",
      categoryId,
      title: card.title,
      description: card.description,
      priceType: "fixed",
      priceAmount: 1000,
      priceUnit: null,
      priceReason: null,
      location: null,
      territoryCode: "abay_region",
      ownershipForm: "peasant_farm",
      productLocation: "elevator",
      productLocationDetail: null,
      serviceAllKazakhstan: false,
      serviceTerritoryCodes: [],
      availability: null,
      sortOrder: 0,
      images: [
        { storagePath: "cards/22222222-2222-4222-8222-222222222222.jpg", sortOrder: 0 },
        { storagePath: "cards/22222222-2222-4222-8222-222222222222.jpg", sortOrder: 1 },
      ],
      specs: [],
      expectedVersion: card.version,
    })).rejects.toMatchObject({ status: 400, details: { code: "DUPLICATE_IMAGE" } });

    expect(await getAdminCardDetail(env, card.id)).toBeDefined();
  });

  test("повтор create с тем же clientRequestId возвращает одну карточку и отклоняет другой payload", async () => {
    const clientRequestId = crypto.randomUUID();
    const input = {
      clientRequestId,
      type: "product" as const,
      categoryId,
      title: "Идемпотентная карточка",
      description: "Описание",
      priceType: "fixed" as const,
      priceAmount: 1000,
      priceUnit: null,
      priceReason: null,
      location: "С места",
      territoryCode: null,
      ownershipForm: null,
      productLocation: null,
      productLocationDetail: null,
      serviceAllKazakhstan: false,
      serviceTerritoryCodes: [],
      availability: null,
      sortOrder: 0,
      images: [],
      specs: [],
    };

    const first = await createCard(env, input);
    const replay = await createCard(env, input);
    expect(replay.id).toBe(first.id);

    await expect(createCard(env, { ...input, title: "Другая карточка" })).rejects.toMatchObject({
      status: 409,
      details: { code: "CARD_CREATE_REQUEST_REUSED" },
    });
  });

  test("повтор PUT с тем же mutationId возвращает receipt, а другой payload получает 409", async () => {
    const card = await createCard(env, {
      type: "product",
      categoryId,
      title: "Карточка с receipt PUT",
      description: "Описание",
      priceType: "fixed",
      priceAmount: 1000,
      priceUnit: null,
      priceReason: null,
      location: null,
      territoryCode: "abay_region",
      ownershipForm: "peasant_farm",
      productLocation: "elevator",
      productLocationDetail: null,
      serviceAllKazakhstan: false,
      serviceTerritoryCodes: [],
      availability: null,
      sortOrder: 0,
      images: [],
      specs: [],
    });
    const mutationId = crypto.randomUUID();
    const input = {
      mutationId,
      type: "product" as const,
      categoryId,
      title: "Карточка с receipt PUT (обновлено)",
      description: card.description,
      priceType: "fixed" as const,
      priceAmount: 1000,
      priceUnit: null,
      priceReason: null,
      location: null,
      territoryCode: "abay_region" as const,
      ownershipForm: "peasant_farm" as const,
      productLocation: "elevator" as const,
      productLocationDetail: null,
      serviceAllKazakhstan: false,
      serviceTerritoryCodes: [],
      availability: null,
      sortOrder: 0,
      images: [],
      specs: [],
      expectedVersion: card.version,
    };

    const first = await updateCard(env, card.id, input);
    const replay = await updateCard(env, card.id, input);
    expect(replay.detail.version).toBe(first.detail.version);
    expect(replay.detail.title).toBe(input.title);
    await expect(updateCard(env, card.id, { ...input, title: "Другой payload" })).rejects.toMatchObject({
      status: 409,
      details: { code: "CARD_UPDATE_REQUEST_REUSED" },
    });

    const newer = await updateCard(env, card.id, {
      ...input,
      mutationId: crypto.randomUUID(),
      title: "Карточка с receipt PUT (новее)",
      expectedVersion: first.detail.version,
    });
    expect(newer.detail.version).toBe(first.detail.version + 1);

    await expect(updateCard(env, card.id, input)).rejects.toMatchObject({
      status: 409,
      details: { code: "CARD_CHANGED_AFTER_REPLAY" },
    });
    await expect(getAdminCardDetailForMutation(env, card.id, mutationId)).rejects.toMatchObject({
      status: 409,
      details: { code: "CARD_CHANGED_AFTER_REPLAY" },
    });
    expect(await getAdminCardDetailForMutation(env, card.id, crypto.randomUUID())).toBeUndefined();
    const current = await getAdminCardDetail(env, card.id);
    expect(current?.version).toBe(newer.detail.version);
    expect(current?.title).toBe(newer.detail.title);
    expect(current?.publicationStatus).toBe("draft");
  });

  test("mutation-scoped detail ждёт concurrent update и не возвращает устаревший snapshot", async () => {
    const card = await createCard(env, {
      type: "product",
      categoryId,
      title: "Карточка для concurrent recovery",
      description: "Описание",
      priceType: "fixed",
      priceAmount: 1000,
      priceUnit: null,
      priceReason: null,
      location: null,
      territoryCode: "abay_region",
      ownershipForm: "peasant_farm",
      productLocation: "elevator",
      productLocationDetail: null,
      serviceAllKazakhstan: false,
      serviceTerritoryCodes: [],
      availability: null,
      sortOrder: 0,
      images: [],
      specs: [],
    });
    const mutationId = crypto.randomUUID();
    const saved = await updateCard(env, card.id, {
      type: "product",
      categoryId,
      title: "Карточка после receipt",
      description: card.description,
      priceType: "fixed",
      priceAmount: 1000,
      priceUnit: null,
      priceReason: null,
      location: null,
      territoryCode: "abay_region",
      ownershipForm: "peasant_farm",
      productLocation: "elevator",
      productLocationDetail: null,
      commodityGroup: "cereals",
      volumeTonnes: 10,
      serviceAllKazakhstan: false,
      serviceTerritoryCodes: [],
      availability: null,
      sortOrder: 0,
      images: [],
      specs: [],
      expectedVersion: card.version,
      mutationId,
    });

    const concurrentSql = postgres(env.DATABASE_URL, { prepare: false, max: 1 });
    const updated = deferred();
    const release = deferred();
    const concurrentUpdate = concurrentSql.begin(async (tx) => {
      await tx`update cards set title = 'Параллельная версия' where id = ${card.id}`;
      updated.resolve();
      await release.promise;
    });

    try {
      await updated.promise;
      let recoverySettled = false;
      const recovery = getAdminCardDetailForMutation(env, card.id, mutationId).finally(() => {
        recoverySettled = true;
      });
      const recoveryRejected = expect(recovery).rejects.toMatchObject({
        status: 409,
        details: { code: "CARD_CHANGED_AFTER_REPLAY" },
      });

      await Bun.sleep(50);
      expect(recoverySettled).toBe(false);
      release.resolve();
      await concurrentUpdate;

      await recoveryRejected;
      expect((await getAdminCardDetail(env, card.id))?.version).toBe(saved.detail.version + 1);
    } finally {
      release.resolve();
      await concurrentUpdate.catch(() => {});
      await concurrentSql.end({ timeout: 0 });
    }
  });

  test("после смены commodity-категории черновик с commodity fields нельзя опубликовать", async () => {
    const ownCategoryId = crypto.randomUUID();
    await sql`
      insert into categories (id, type, name, sort_order, is_commodity, required_specs)
      values (${ownCategoryId}, 'product', ${`[integration] sequential ${ownCategoryId}`}, 0, true, '{}')
    `;

    try {
      const card = await createCard(env, {
        type: "product",
        categoryId: ownCategoryId,
        title: "Commodity draft перед сменой категории",
        description: "Готовое описание",
        priceType: "fixed",
        priceAmount: 1000,
        priceUnit: "за тонну",
        priceReason: null,
        location: null,
        territoryCode: "abay_region",
        ownershipForm: "peasant_farm",
        productLocation: "elevator",
        productLocationDetail: null,
        commodityGroup: "cereals",
        volumeTonnes: 12,
        serviceAllKazakhstan: false,
        serviceTerritoryCodes: [],
        availability: null,
        sortOrder: 0,
        images: [{ storagePath: `cards/${crypto.randomUUID()}.jpg`, sortOrder: 0 }],
        specs: [],
      });

      await updateCategory(env, ownCategoryId, { isCommodity: false });
      await expect(publishCard(env, card.id, card.version)).rejects.toMatchObject({ status: 400 });
      expect((await getAdminCardDetail(env, card.id))?.publicationStatus).toBe("draft");
    } finally {
      await sql`delete from cards where category_id = ${ownCategoryId}`;
      await sql`delete from categories where id = ${ownCategoryId}`;
    }
  });

  test("publish сериализуется со сменой category commodity flag", async () => {
    const ownCategoryId = crypto.randomUUID();
    await sql`
      insert into categories (id, type, name, sort_order, is_commodity, required_specs)
      values (${ownCategoryId}, 'product', ${`[integration] concurrent ${ownCategoryId}`}, 0, false, '{}')
    `;

    const categorySql = postgres(env.DATABASE_URL, { prepare: false, max: 1 });
    const locked = deferred();
    const release = deferred();
    let categoryChange: Promise<unknown> | undefined;
    try {
      const card = await createCard(env, {
        type: "product",
        categoryId: ownCategoryId,
        title: "Draft без commodity fields",
        description: "Готовое описание",
        priceType: "fixed",
        priceAmount: 1000,
        priceUnit: "за тонну",
        priceReason: null,
        location: null,
        territoryCode: "abay_region",
        ownershipForm: "peasant_farm",
        productLocation: "elevator",
        productLocationDetail: null,
        serviceAllKazakhstan: false,
        serviceTerritoryCodes: [],
        availability: null,
        sortOrder: 0,
        images: [{ storagePath: `cards/${crypto.randomUUID()}.jpg`, sortOrder: 0 }],
        specs: [],
      });

      categoryChange = categorySql.begin(async (tx) => {
        await tx`select id from categories where id = ${ownCategoryId} for update`;
        locked.resolve();
        await release.promise;
        await tx`update categories set is_commodity = true where id = ${ownCategoryId}`;
      });
      await locked.promise;

      let publicationSettled = false;
      const publication = publishCard(env, card.id, card.version).finally(() => {
        publicationSettled = true;
      });
      const publicationRejected = expect(publication).rejects.toMatchObject({ status: 400 });
      await Bun.sleep(50);
      expect(publicationSettled).toBe(false);

      release.resolve();
      await categoryChange;
      await publicationRejected;
      expect((await getAdminCardDetail(env, card.id))?.publicationStatus).toBe("draft");
    } finally {
      release.resolve();
      await categoryChange?.catch(() => {});
      await categorySql.end({ timeout: 0 });
      await sql`delete from cards where category_id = ${ownCategoryId}`;
      await sql`delete from categories where id = ${ownCategoryId}`;
    }
  });

  test("E2E cleanup uses an escaped run prefix", async () => {
    const runId = "integration-under-score";
    const ownCategoryId = crypto.randomUUID();
    const neighboringCategoryId = crypto.randomUUID();
    await sql`
      insert into categories (id, type, name, sort_order, required_specs)
      values
        (${ownCategoryId}, 'service', ${`[e2e:${runId}] own`}, 0, '{}'),
        (${neighboringCategoryId}, 'service', '[e2e:integrationXunderXscore] neighbor', 0, '{}')
    `;

    await cleanupE2eRun({ ...env, E2E_RUN_ID: runId });

    const ownRemaining = await sql<{ id: string }[]>`select id from categories where id = ${ownCategoryId}`;
    const neighboringRemaining = await sql<{ id: string }[]>`select id from categories where id = ${neighboringCategoryId}`;
    expect(ownRemaining).toHaveLength(0);
    expect(neighboringRemaining.map((row) => row.id)).toEqual([neighboringCategoryId]);
    await sql`delete from categories where id = ${neighboringCategoryId}`;
  });

  test("E2E cleanup removes anonymous users only for the current run", async () => {
    const runId = `anonymous-${crypto.randomUUID().replaceAll("-", "").slice(0, 20)}`;
    const ownUserId = crypto.randomUUID();
    const neighboringUserId = crypto.randomUUID();
    const ownTelegramId = 800_000_000_123;
    const neighboringTelegramId = ownTelegramId + 1;
    await sql`
      insert into users (id, telegram_id, telegram_first_name)
      values
        (${ownUserId}, ${ownTelegramId}, ${`[e2e:${runId}] Guest`}),
        (${neighboringUserId}, ${neighboringTelegramId}, ${`[e2e:${runId}X] Neighbor`})
    `;

    try {
      await cleanupE2eRun({ ...env, E2E_RUN_ID: runId });
      expect(await sql`select id from users where id = ${ownUserId}`).toHaveLength(0);
      expect(await sql`select id from users where id = ${neighboringUserId}`).toHaveLength(1);
    } finally {
      await sql`delete from users where id in (${ownUserId}, ${neighboringUserId})`;
    }
  });

  test("E2E cleanup removes an unbound run-scoped upload", async () => {
    const runId = `unbound-${crypto.randomUUID().replaceAll("-", "").slice(0, 20)}`;
    const storagePath = `e2e/${runId}/${crypto.randomUUID()}.jpg`;
    const realFetchForTest = globalThis.fetch;
    let deleteCalls = 0;
    globalThis.fetch = (async (input, init) => {
      const method = init?.method ?? "GET";
      if (method === "POST" && String(input).includes("/storage/v1/object/list/")) {
        return Response.json([{ name: storagePath.slice(`e2e/${runId}/`.length), created_at: new Date().toISOString() }]);
      }
      if (method === "DELETE") {
        deleteCalls += 1;
        return Response.json([{ name: storagePath }]);
      }
      return realFetchForTest(input, init);
    }) as typeof fetch;

    try {
      await cleanupE2eRun({ ...env, E2E_RUN_ID: runId });
      expect(deleteCalls).toBe(1);
    } finally {
      globalThis.fetch = realFetchForTest;
    }
  });

  test("E2E cleanup reconciles a lost DELETE response when HEAD confirms absence", async () => {
    const runId = `lost-delete-${crypto.randomUUID().replaceAll("-", "").slice(0, 20)}`;
    const storagePrefix = `e2e/${runId}/`;
    const storagePath = `${storagePrefix}${crypto.randomUUID()}.jpg`;

    const realFetchForTest = globalThis.fetch;
    let deleteCalls = 0;
    let headCalls = 0;
    globalThis.fetch = (async (input, init) => {
      const method = init?.method ?? "GET";
      if (method === "POST" && String(input).includes("/storage/v1/object/list/")) {
        return Response.json([{ name: storagePath.slice(storagePrefix.length), created_at: new Date().toISOString() }]);
      }
      if (method === "DELETE") {
        deleteCalls += 1;
        throw new Error("response lost after Storage applied DELETE");
      }
      if (method === "HEAD") {
        headCalls += 1;
        return new Response(null, { status: 404 });
      }
      return realFetchForTest(input, init);
    }) as typeof fetch;

    try {
      await cleanupE2eRun({ ...env, E2E_RUN_ID: runId });
      expect(deleteCalls).toBe(1);
      expect(headCalls).toBe(1);
    } finally {
      globalThis.fetch = realFetchForTest;
    }
  });

  test("E2E cleanup retries only failed Storage paths after partial success", async () => {
    const runId = `storage-${crypto.randomUUID().replaceAll("-", "").slice(0, 20)}`;
    const ownCategoryId = crypto.randomUUID();
    const cardId = crypto.randomUUID();
    const storagePrefix = `e2e/${runId}/`;
    const deletedOnFirstAttempt = `${storagePrefix}${crypto.randomUUID()}.jpg`;
    const failedOnFirstAttempt = `${storagePrefix}${crypto.randomUUID()}.jpg`;
    await sql`
      insert into categories (id, type, name, sort_order, required_specs)
      values (${ownCategoryId}, 'product', ${`[e2e:${runId}] storage category`}, 0, '{}')
    `;
    await sql`
      insert into cards (id, type, category_id, title, price_type, price_amount, sort_order)
      values (${cardId}, 'product', ${ownCategoryId}, ${`[e2e:${runId}] storage card`}, 'fixed', 1, 0)
    `;
    await sql`
      insert into card_images (card_id, storage_path, sort_order)
      values
        (${cardId}, ${deletedOnFirstAttempt}, 0),
        (${cardId}, ${failedOnFirstAttempt}, 1)
    `;

    const realFetch = globalThis.fetch;
    let deleteAttempts = 0;
    let listAttempts = 0;
    globalThis.fetch = (async (input, init) => {
      const method = init?.method ?? "GET";
      if (method === "POST" && String(input).includes("/storage/v1/object/list/")) {
        listAttempts += 1;
        const paths = listAttempts === 1
          ? [deletedOnFirstAttempt, failedOnFirstAttempt]
          : [failedOnFirstAttempt];
        return Response.json(paths.map((path) => ({
          name: path.slice(storagePrefix.length),
          created_at: new Date().toISOString(),
        })));
      }
      if (method === "DELETE") {
        deleteAttempts += 1;
        return deleteAttempts === 1
          ? Response.json([{ name: deletedOnFirstAttempt }])
          : Response.json([{ name: failedOnFirstAttempt }]);
      }
      if (method === "HEAD") return new Response(null, { status: 200 });
      return realFetch(input, init);
    }) as typeof fetch;

    try {
      await expect(cleanupE2eRun({ ...env, E2E_RUN_ID: runId })).rejects.toThrow("Storage cleanup failed");
      expect(await sql`select id from cards where id = ${cardId}`).toHaveLength(1);
      expect(await sql<{ storage_path: string }[]>`
        select storage_path from card_images where card_id = ${cardId} order by sort_order
      `).toEqual([
        { storage_path: deletedOnFirstAttempt },
        { storage_path: failedOnFirstAttempt },
      ]);

      await cleanupE2eRun({ ...env, E2E_RUN_ID: runId });
      expect(await sql`select id from cards where id = ${cardId}`).toHaveLength(0);
      expect(await sql`select id from categories where id = ${ownCategoryId}`).toHaveLength(0);
      expect(deleteAttempts).toBe(2);
    } finally {
      globalThis.fetch = realFetch;
      await sql`delete from cards where id = ${cardId}`;
      await sql`delete from categories where id = ${ownCategoryId}`;
    }
  });
});
