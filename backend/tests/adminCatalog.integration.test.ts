import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import postgres from "postgres";
import { adminCardListResponse } from "@agromarket/contracts";
import type { AppEnv } from "../src/env";
import { createDatabaseInvocation } from "../src/db";
import {
  archiveCard as archiveCardRepo,
  createCard as createCardRepo,
  deleteCard as deleteCardRepo,
  publishCard as publishCardRepo,
  updateCard as updateCardRepo,
} from "../src/repos/adminCatalog";
import {
  adminListCards as adminListCardsRepo,
  getAdminCardDetail as getAdminCardDetailRepo,
  getAdminCardDetailForMutation as getAdminCardDetailForMutationRepo,
} from "../src/repos/adminCardReads";
import {
  createCategory as createCategoryRepo,
  deleteCategory as deleteCategoryRepo,
  listCategoriesAdmin as listCategoriesAdminRepo,
  updateCategory as updateCategoryRepo,
} from "../src/repos/adminCategories";
import { appendAdminAuditEvent as appendAdminAuditEventRepo } from "../src/repos/adminAudit";
import { cleanupE2eRun as cleanupE2eRunRepo } from "../src/repos/e2eCleanup";
import { acceptTelegramUpdate as acceptTelegramUpdateRepo } from "../src/repos/telegramUpdates";
import { getCardById, listCards, listCategories } from "../src/repos/catalog";
import { addFavorite, listFavorites } from "../src/repos/favorites";
import { createRequest } from "../src/repos/requests";
import {
  createUploadClaim as createUploadClaimRepo,
  markUploadClaimValidated as markUploadClaimValidatedRepo,
} from "../src/repos/uploadClaims";

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
  const db = createDatabaseInvocation(env);
  const createCard = (environment: AppEnv, input: Parameters<typeof createCardRepo>[1], options?: Parameters<typeof createCardRepo>[3]) =>
    createCardRepo(environment, input, db, options);
  const updateCard = (environment: AppEnv, id: string, input: Parameters<typeof updateCardRepo>[2], options?: Parameters<typeof updateCardRepo>[4]) =>
    updateCardRepo(environment, id, input, db, options);
  const updateCategory = (environment: AppEnv, id: string, input: Parameters<typeof updateCategoryRepo>[2]) =>
    updateCategoryRepo(environment, id, input, db);
  const createCategory = (environment: AppEnv, input: Parameters<typeof createCategoryRepo>[1]) =>
    createCategoryRepo(environment, input, db);
  const listCategoriesAdmin = (environment: AppEnv, type: "product" | "service") =>
    listCategoriesAdminRepo(environment, type, db);
  const publishCard = (environment: AppEnv, id: string, expectedVersion: number) =>
    publishCardRepo(environment, id, expectedVersion, db);
  const archiveCard = (environment: AppEnv, id: string, expectedVersion: number) =>
    archiveCardRepo(environment, id, expectedVersion, db);
  const deleteCard = (environment: AppEnv, id: string, expectedVersion: number) =>
    deleteCardRepo(environment, id, expectedVersion, db);
  const deleteCategory = (environment: AppEnv, id: string) =>
    deleteCategoryRepo(environment, id, db);
  const getAdminCardDetail = (environment: AppEnv, id: string) =>
    getAdminCardDetailRepo(environment, id, db);
  const adminListCards = (environment: AppEnv, query: Parameters<typeof adminListCardsRepo>[1]) =>
    adminListCardsRepo(environment, query, db);
  const getAdminCardDetailForMutation = (environment: AppEnv, id: string, mutationId: string) =>
    getAdminCardDetailForMutationRepo(environment, id, mutationId, db);
  const appendAdminAuditEvent = (environment: AppEnv, input: Parameters<typeof appendAdminAuditEventRepo>[1]) =>
    appendAdminAuditEventRepo(environment, input, db);
  const acceptTelegramUpdate = (environment: AppEnv, updateId: number, action: Parameters<typeof acceptTelegramUpdateRepo>[2]) =>
    acceptTelegramUpdateRepo(environment, updateId, action, db);
  const cleanupE2eRun = (environment: Parameters<typeof cleanupE2eRunRepo>[0]) =>
    cleanupE2eRunRepo(environment, db);
  const createUploadClaim = (environment: AppEnv, input: Parameters<typeof createUploadClaimRepo>[1]) =>
    createUploadClaimRepo(environment, input, db);
  const markUploadClaimValidated = (
    environment: AppEnv,
    input: Parameters<typeof markUploadClaimValidatedRepo>[1],
  ) => markUploadClaimValidatedRepo(environment, input, db);
  const realFetch = globalThis.fetch;
  let categoryId: string;
  const auditUserId = crypto.randomUUID();
  const auditTelegramId = 8_000_000_001;
  const telegramUpdateId = 8_000_000_002;

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
    await sql`
      insert into users (id, telegram_id, telegram_first_name)
      values (${auditUserId}, ${auditTelegramId}, '[integration] audit actor')
    `;
  });

  afterAll(async () => {
    globalThis.fetch = realFetch;
    await db.dispose();
    await sql`delete from app_private.telegram_updates where update_id = ${telegramUpdateId}`;
    await sql`delete from app_private.admin_audit_events where actor_user_id = ${auditUserId}`;
    await sql`delete from users where id = ${auditUserId}`;
    await sql`delete from cards where category_id = ${categoryId}`;
    await sql`delete from categories where id = ${categoryId}`;
    await sql.end({ timeout: 0 });
  });

  test("создаёт черновик, сохраняет фото и данные, затем публикует", async () => {
    const created = await createCard(env, {
      type: "product" as const,
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
    const draftList = adminCardListResponse.parse(await adminListCards(env, {
      type: "product",
      categoryId,
      archived: "all",
      limit: 20,
      offset: 0,
    }));
    expect(draftList.items.find((card) => card.id === created.id)).toMatchObject({
      needsReview: created.needsReview,
      reviewIssues: created.reviewIssues,
      publicationStatus: created.publicationStatus,
    });

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
    const readyList = adminCardListResponse.parse(await adminListCards(env, {
      type: "product",
      categoryId,
      archived: "all",
      limit: 20,
      offset: 0,
    }));
    expect(readyList.items.find((card) => card.id === created.id)).toMatchObject({
      needsReview: updated.detail.needsReview,
      reviewIssues: updated.detail.reviewIssues,
      publicationStatus: updated.detail.publicationStatus,
    });

    const published = await publishCard(env, created.id, updated.detail.version);
    expect(published.publicationStatus).toBe("published");
    expect(published.reviewIssues).toEqual([]);
  });

  test("не удаляет занятую категорию и поддерживает archive/delete lifecycle", async () => {
    const ownCategoryId = crypto.randomUUID();
    await sql`
      insert into categories (id, type, name, sort_order, is_commodity, required_specs)
      values (${ownCategoryId}, 'product', ${`[integration] lifecycle ${ownCategoryId}`}, 0, false, '{}')
    `;

    try {
      const draft = await createCard(env, {
        type: "product",
        categoryId: ownCategoryId,
        title: "Карточка archive/delete",
        description: "Готовое описание для жизненного цикла",
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

      await expect(deleteCategory(env, ownCategoryId)).rejects.toMatchObject({ status: 409 });
      const published = await publishCard(env, draft.id, draft.version);
      const archived = await archiveCard(env, published.id, published.version);
      expect(archived.publicationStatus).toBe("archived");

      await expect(deleteCard(env, archived.id, archived.version)).resolves.toEqual([
        archived.images[0]?.storagePath,
      ]);
      expect(await getAdminCardDetail(env, archived.id)).toBeUndefined();
    } finally {
      await sql`delete from cards where category_id = ${ownCategoryId}`;
      await sql`delete from categories where id = ${ownCategoryId}`;
    }
  });

  test("category boundary characterizes create/list/update/delete", async () => {
    const created = await createCategory(env, {
      type: "service",
      name: `Категория границы ${crypto.randomUUID()}`,
      sortOrder: 7,
      isCommodity: false,
      requiredSpecs: ["Лицензия"],
    });

    try {
      const updated = await updateCategory(env, created.id, {
        name: `${created.name} (обновлено)`,
        sortOrder: 8,
        requiredSpecs: ["Опыт"],
      });
      expect(updated).toMatchObject({
        id: created.id,
        sortOrder: 8,
        requiredSpecs: ["Опыт"],
      });
      expect((await listCategoriesAdmin(env, "service")).find((category) => category.id === created.id)).toMatchObject({
        name: updated.name,
        cardCount: 0,
        activeCardCount: 0,
      });
    } finally {
      await deleteCategory(env, created.id);
    }

    expect((await listCategoriesAdmin(env, "service")).find((category) => category.id === created.id)).toBeUndefined();
  });

  test("create consumes only the actor's validated upload claim", async () => {
    const storagePath = `cards/${crypto.randomUUID()}.jpg`;
    await createUploadClaim(env, {
      storagePath,
      issuerUserId: auditUserId,
      contentType: "image/jpeg",
    });
    await markUploadClaimValidated(env, {
      storagePath,
      issuerUserId: auditUserId,
      contentType: "image/jpeg",
    });

    const input = {
      type: "product",
      categoryId,
      title: "Карточка с claimed upload",
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
      images: [{ storagePath, sortOrder: 0 }],
      specs: [],
    };
    await expect(createCard(env, input, { actorUserId: crypto.randomUUID() })).rejects.toMatchObject({ status: 409 });

    const card = await createCard(env, input, { actorUserId: auditUserId });
    expect(card.images.map((image) => image.storagePath)).toEqual([storagePath]);
    expect(await sql<{ consumed_at: Date | null }[]>`
      select consumed_at from app_private.card_image_upload_claims where storage_path = ${storagePath}
    `).toEqual([expect.objectContaining({ consumed_at: expect.any(Date) })]);
  });

  test("публичная видимость едина для каталога, избранного и заявок", async () => {
    const visibilityCategoryId = crypto.randomUUID();
    const visibilityUserId = crypto.randomUUID();
    const visibilityTelegramId = 8_100_000_000 + Math.floor(Math.random() * 100_000_000);
    const prefix = `[visibility] ${crypto.randomUUID()}`;
    const createVisibilityCard = (suffix: string) => createCard(env, {
      type: "product",
      categoryId: visibilityCategoryId,
      title: `${prefix} ${suffix}`,
      description: "Полное описание для проверки видимости",
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

    await sql`
      insert into categories (id, type, name, sort_order, is_commodity, required_specs)
      values (${visibilityCategoryId}, 'product', ${prefix}, 0, false, ${[]})
    `;
    await sql`
      insert into users (id, telegram_id, telegram_first_name)
      values (${visibilityUserId}, ${visibilityTelegramId}, ${prefix})
    `;

    try {
      const draft = await createVisibilityCard("draft");
      const activeDraft = await createVisibilityCard("published");
      const published = await publishCard(env, activeDraft.id, activeDraft.version);
      const archivedDraft = await createVisibilityCard("archived");
      const archived = await publishCard(env, archivedDraft.id, archivedDraft.version);
      await sql`update cards set archived_at = now() where id = ${archived.id}`;

      const catalog = await listCards(env, {
        type: "product",
        search: prefix,
        limit: 20,
        offset: 0,
        region: "all_regions",
        sort: "default",
        productLocation: "all",
      }, db);
      expect(catalog.items.map((card) => card.id)).toEqual([published.id]);
      expect(await getCardById(env, published.id, db)).toBeDefined();
      expect(await getCardById(env, draft.id, db)).toBeUndefined();
      expect(await getCardById(env, archived.id, db)).toBeUndefined();

      const categories = await listCategories(env, "product", db, true);
      expect(categories.find((category) => category.id === visibilityCategoryId)?.cardCount).toBe(1);

      await addFavorite(env, visibilityUserId, published.id, db);
      await sql`
        insert into favorites (user_id, card_id)
        values (${visibilityUserId}, ${archived.id})
        on conflict do nothing
      `;
      await expect(addFavorite(env, visibilityUserId, draft.id, db)).rejects.toMatchObject({ status: 404 });
      await expect(addFavorite(env, visibilityUserId, archived.id, db)).rejects.toMatchObject({ status: 404 });
      expect((await listFavorites(env, visibilityUserId, db)).map((card) => card.id)).toEqual([published.id]);

      const requestFor = (cardId: string) => createRequest(env, visibilityUserId, {
        source: "card",
        cardId,
        clientRequestId: crypto.randomUUID(),
        contactName: "Тестовый покупатель",
        contactPhone: "+77011234567",
      }, crypto.randomUUID(), null, db);
      expect((await requestFor(published.id)).created).toBe(true);
      await expect(requestFor(draft.id)).rejects.toMatchObject({ status: 409 });
      await expect(requestFor(archived.id)).rejects.toMatchObject({ status: 409 });
    } finally {
      await sql`delete from requests where user_id = ${visibilityUserId}`;
      await sql`delete from favorites where user_id = ${visibilityUserId}`;
      await sql`delete from cards where category_id = ${visibilityCategoryId}`;
      await sql`delete from categories where id = ${visibilityCategoryId}`;
      await sql`delete from users where id = ${visibilityUserId}`;
    }
  });

  test("сохраняет audit metadata как JSON object", async () => {
    const requestId = crypto.randomUUID();
    await appendAdminAuditEvent(env, {
      actor: {
        userId: auditUserId,
        telegramId: auditTelegramId,
        isRegistered: false,
      },
      requestId,
      action: "post:categories",
      targetType: "categories",
      metadata: { status: 201 },
    });

    const [row] = await sql<{ metadata: Record<string, unknown> }[]>`
      select metadata
      from app_private.admin_audit_events
      where request_id = ${requestId}
    `;
    expect(row?.metadata).toEqual({ status: 201 });
  });

  test("сохраняет Telegram action как JSON object", async () => {
    expect(await acceptTelegramUpdate(env, telegramUpdateId, {
      type: "greet",
      chatId: auditTelegramId,
    })).toBe(true);

    const [row] = await sql<{ action: Record<string, unknown> }[]>`
      select action
      from app_private.telegram_updates
      where update_id = ${telegramUpdateId}
    `;
    expect(row?.action).toEqual({
      type: "greet",
      chatId: auditTelegramId,
    });
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
      const recoveryOutcome = recovery.then(
        (value) => ({ status: "fulfilled" as const, value }),
        (error: unknown) => ({ status: "rejected" as const, error }),
      );

      await Bun.sleep(50);
      expect(recoverySettled).toBe(false);
      release.resolve();
      await concurrentUpdate;

      expect(await recoveryOutcome).toMatchObject({
        status: "rejected",
        error: {
          status: 409,
          details: { code: "CARD_CHANGED_AFTER_REPLAY" },
        },
      });
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
      const publicationOutcome = publication.then(
        (value) => ({ status: "fulfilled" as const, value }),
        (error: unknown) => ({ status: "rejected" as const, error }),
      );
      await Bun.sleep(50);
      expect(publicationSettled).toBe(false);

      release.resolve();
      await categoryChange;
      expect(await publicationOutcome).toMatchObject({
        status: "rejected",
        error: { status: 400 },
      });
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

  test("E2E cleanup removes audit events for users in the current run", async () => {
    const runId = `audited-${crypto.randomUUID().replaceAll("-", "").slice(0, 20)}`;
    const userId = crypto.randomUUID();
    const telegramId = 800_000_000_321;
    await sql`
      insert into users (id, telegram_id, telegram_first_name)
      values (${userId}, ${telegramId}, ${`[e2e:${runId}] Audited admin`})
    `;
    await sql`
      insert into app_private.admin_audit_events (
        actor_user_id, actor_telegram_id, request_id, action, target_type, metadata
      )
      values (
        ${userId}, ${telegramId}, ${crypto.randomUUID()}, 'category.create', 'category', '{}'
      )
    `;

    try {
      await cleanupE2eRun({ ...env, E2E_RUN_ID: runId });
      expect(await sql`select id from users where id = ${userId}`).toHaveLength(0);
      expect(
        await sql`select id from app_private.admin_audit_events where actor_user_id = ${userId}`,
      ).toHaveLength(0);
    } finally {
      await sql`delete from app_private.admin_audit_events where actor_user_id = ${userId}`;
      await sql`delete from users where id = ${userId}`;
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
