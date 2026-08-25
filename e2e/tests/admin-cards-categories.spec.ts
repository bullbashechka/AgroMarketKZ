import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "../fixtures/auth.fixture";
import type { Route } from "@playwright/test";
import { api, createTestCard, createTestCategory, E2E_PREFIX } from "../helpers/api";
import { gotoAdminSection } from "../helpers/nav";

const TEST_IMAGE = path.join(path.dirname(fileURLToPath(import.meta.url)), "../fixtures/test-image.jpg");
const ADMIN_CARD_EDIT_URL = /\/admin\/cards\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

test.describe("Админ — категории и карточки", () => {
  test("создание категории, создание и редактирование карточки", async ({ adminPage: page }) => {
    test.setTimeout(90_000);
    const categoryName = `${E2E_PREFIX} Кат. ${Date.now()}`;
    let categoryId: string | undefined;

    await gotoAdminSection(page, "/admin/categories");
    await page.getByTestId("segmented-product").click();
    await page.getByTestId("admin-category-new").click();
    await page.getByTestId("admin-category-name-input").fill(categoryName);
    await page.getByTestId("admin-category-save").click();

    const categoryRow = page.getByTestId("admin-category-row").filter({ hasText: categoryName });
    await expect(categoryRow).toBeVisible({ timeout: 15_000 });
    categoryId = await categoryRow.getAttribute("data-category-id") ?? undefined;

    await categoryRow.click();
    await page.getByRole("button", { name: "Обязательные характеристики" }).click();
    await page.getByTestId("admin-required-spec-add").click();
    await page.getByTestId("admin-required-spec-input").fill("Год выпуска");
    await page.getByTestId("admin-required-spec-save").click();

    await gotoAdminSection(page, "/admin/cards");
    await page.getByTestId("segmented-product").click();
    await page.getByTestId("admin-card-new").click();
    await page.getByTestId("card-editor-category").selectOption(categoryId!);
    const cardTitle = `${E2E_PREFIX} Карточка ${Date.now()}`;
    await page.getByTestId("card-editor-title").fill(cardTitle);
    await page.getByTestId("card-editor-save").click();

    await expect(page).toHaveURL(ADMIN_CARD_EDIT_URL, { timeout: 15_000 });
    await expect(page.getByTestId("card-editor-publish")).toBeVisible({ timeout: 15_000 });
    await expect(page.locator('input[type="file"]')).toBeAttached();
    await page.getByTestId("card-editor-description").fill("Тестовое описание опубликованной карточки");
    await page.getByTestId("card-editor-price").fill("5000");
    await page.getByTestId("card-editor-price-unit").fill("за штуку");
    await page.getByTestId("card-editor-territory").selectOption({ index: 1 });
    await page.getByLabel("Форма собственности").selectOption({ index: 1 });
    await page.getByLabel("Местонахождение товара").selectOption({ index: 1 });
    await page.getByTestId("card-spec-value-0").fill("2024");
    await page.locator('input[type="file"]').setInputFiles(TEST_IMAGE);
    await expect(page.getByTestId("card-image-upload-status")).toHaveText("Фото готово к публикации.", {
      timeout: 20_000,
    });
    await expect(page.getByTestId("card-editor-description")).toHaveValue("Тестовое описание опубликованной карточки");
    await expect(page.getByTestId("card-spec-value-0")).toHaveValue("2024");
    await expect(page.getByTestId("card-editor-publish")).toBeEnabled({ timeout: 20_000 });
    await page.getByTestId("card-editor-publish").click();

    await expect(page).toHaveURL(/\/admin\/cards$/, { timeout: 30_000 });
    // Сохранение редиректит на /admin/cards без query — вкладка сбрасывается на «Услуги» по умолчанию.
    await page.getByTestId("segmented-product").click();

    const cardRow = page.getByTestId("admin-card-row").filter({ hasText: cardTitle });
    await expect(cardRow).toBeVisible({ timeout: 15_000 });
    await cardRow.click();

    const updatedTitle = `${cardTitle} (изменено)`;
    await expect(page.getByTestId("card-editor-title")).toBeVisible({ timeout: 15_000 });
    await page.getByTestId("card-editor-title").fill(updatedTitle);
    await expect(page.getByTestId("card-editor-save")).toBeEnabled({ timeout: 20_000 });
    await page.getByTestId("card-editor-save").click();
    await expect(page).toHaveURL(/\/admin\/cards$/, { timeout: 15_000 });
    await page.getByTestId("segmented-product").click();
    await expect(page.getByTestId("admin-card-row").filter({ hasText: updatedTitle })).toBeVisible({
      timeout: 15_000
    });
  });

  test("потерянный ответ create не создаёт дубль", async ({ adminPage: page, adminSession }) => {
    test.setTimeout(60_000);
    const category = await createTestCategory(adminSession, "product");
    const title = `${E2E_PREFIX} Потерянный create ${Date.now()}`;
    let simulatedLostResponses = 0;
    const loseCreateResponse = async (route: Route) => {
      if (route.request().method() === "POST" && simulatedLostResponses === 0) {
        simulatedLostResponses += 1;
        await route.fetch();
        await route.fulfill({
          status: 599,
          contentType: "application/json",
          body: JSON.stringify({ error: "simulated response loss" }),
        });
        return;
      }
      await route.continue();
    };

    await page.route("**/admin/cards", loseCreateResponse);
    try {
      await gotoAdminSection(page, "/admin/cards");
      await page.getByTestId("segmented-product").click();
      await page.getByTestId("admin-card-new").click();
      await page.getByTestId("card-editor-category").selectOption(category.id);
      await page.getByTestId("card-editor-title").fill(title);
      await page.getByTestId("card-editor-save").click();
      await expect(page).toHaveURL(ADMIN_CARD_EDIT_URL, { timeout: 15_000 });
      const cardId = new URL(page.url()).pathname.split("/").pop();
      expect(cardId).toMatch(/^[0-9a-f-]{36}$/i);
      expect(simulatedLostResponses).toBe(1);

      await gotoAdminSection(page, "/admin/cards");
      await page.getByTestId("segmented-product").click();
      const row = page.getByTestId("admin-card-row").filter({ hasText: title });
      await expect(row).toHaveCount(1, { timeout: 15_000 });
    } finally {
      await page.unroute("**/admin/cards", loseCreateResponse);
    }
  });

  test("потерянный ответ PUT после commit сверяет карточку и не создаёт конфликт версии", async ({ adminPage: page, adminSession }) => {
    test.setTimeout(60_000);
    const category = await createTestCategory(adminSession, "product");
    const title = `${E2E_PREFIX} Потерянный PUT ${Date.now()}`;
    const updatedTitle = `${title} (обновлено)`;
    const card = await createTestCard(adminSession, category.id, "product", { title });
    let simulatedLostResponses = 0;
    const loseFirstPutResponse = async (route: Route) => {
      if (route.request().method() === "PUT" && simulatedLostResponses === 0) {
        simulatedLostResponses += 1;
        await route.fetch();
        await route.fulfill({
          status: 599,
          contentType: "application/json",
          body: JSON.stringify({ error: "simulated response loss" }),
        });
        return;
      }
      await route.continue();
    };

    await page.route("**/admin/cards/*", loseFirstPutResponse);
    try {
      await gotoAdminSection(page, "/admin/cards");
      await page.getByTestId("segmented-product").click();
      const row = page.getByTestId("admin-card-row").filter({ hasText: title });
      await expect(row).toHaveCount(1, { timeout: 15_000 });
      await row.click();
      await expect(page.getByTestId("card-editor-title")).toHaveValue(title, { timeout: 15_000 });

      await page.getByTestId("card-editor-title").fill(updatedTitle);
      await page.getByTestId("card-editor-save").click();

      expect(simulatedLostResponses).toBe(1);
      await expect(page).toHaveURL(/\/admin\/cards$/, { timeout: 15_000 });
      await page.getByTestId("segmented-product").click();
      const updatedRow = page.getByTestId("admin-card-row").filter({ hasText: updatedTitle });
      await expect(updatedRow).toHaveCount(1, { timeout: 15_000 });
      await expect(updatedRow).toHaveAttribute("data-card-id", card.id);
      await expect(page.getByText("Версия карточки устарела", { exact: false })).toHaveCount(0);
    } finally {
      await page.unroute("**/admin/cards/*", loseFirstPutResponse);
    }
  });

  test("ошибка publish после закоммиченного PUT остаётся видимой в редакторе", async ({ adminPage: page, adminSession }) => {
    test.setTimeout(60_000);
    const category = await createTestCategory(adminSession, "product");
    const title = `${E2E_PREFIX} Ошибка publish ${Date.now()}`;
    const updatedTitle = `${title} (обновлено)`;
    const card = await createTestCard(adminSession, category.id, "product", {
      title,
      description: "Готовая карточка для проверки ошибки публикации",
      priceAmount: 1000,
      priceUnit: "за штуку",
      territoryCode: "abay_region",
      ownershipForm: "peasant_farm",
      productLocation: "elevator",
    });
    let publishAttempts = 0;
    const failPublish = async (route: Route) => {
      if (route.request().method() !== "POST") {
        await route.continue();
        return;
      }
      publishAttempts += 1;
      await route.fulfill({
        status: 500,
        contentType: "application/json",
        headers: { "X-Request-ID": "e2e-publish-error" },
        body: JSON.stringify({
          error: "Смоделированная ошибка публикации",
          code: "INTERNAL_ERROR",
          requestId: "e2e-publish-error",
        }),
      });
    };

    await page.route("**/admin/cards/*/publish", failPublish);
    try {
      await gotoAdminSection(page, "/admin/cards");
      await page.getByTestId("segmented-product").click();
      await page.getByTestId("admin-card-row").filter({ hasText: title }).click();
      await expect(page.getByTestId("card-editor-title")).toHaveValue(title, { timeout: 15_000 });
      await page.locator('input[type="file"]').setInputFiles(TEST_IMAGE);
      await expect(page.getByTestId("card-image-upload-status")).toHaveText("Фото готово к публикации.", {
        timeout: 20_000,
      });
      await page.getByTestId("card-editor-title").fill(updatedTitle);
      await page.getByTestId("card-editor-publish").click();

      await expect(page).toHaveURL(new RegExp(`/admin/cards/${card.id}$`), { timeout: 15_000 });
      const publishAlert = page.getByRole("alert").filter({ hasText: "Смоделированная ошибка публикации" });
      await expect(publishAlert).toContainText("Смоделированная ошибка публикации", { timeout: 15_000 });
      await expect(publishAlert).toContainText("e2e-publish-error");
      await expect(page.getByRole("button", { name: "Повторить проверку", exact: true })).toBeVisible();
      await expect(page.getByTestId("card-editor-title")).toBeDisabled();
      expect(publishAttempts).toBe(2);

      const reconciled = await api.get<{ title: string; publicationStatus: string }>(`/admin/cards/${card.id}`, adminSession);
      expect(reconciled.title).toBe(updatedTitle);
      expect(reconciled.publicationStatus).toBe("draft");
    } finally {
      await page.unroute("**/admin/cards/*/publish", failPublish);
    }
  });

  test("потерянный ответ publish после commit не оставляет конфликт версии", async ({ adminPage: page, adminSession }) => {
    test.setTimeout(90_000);
    const category = await createTestCategory(adminSession, "product");
    const title = `${E2E_PREFIX} Потерянный publish ${Date.now()}`;
    let simulatedLostResponses = 0;
    const loseFirstPublishResponse = async (route: Route) => {
      if (route.request().method() === "POST" && simulatedLostResponses === 0) {
        simulatedLostResponses += 1;
        await route.fetch();
        await route.fulfill({
          status: 599,
          contentType: "application/json",
          body: JSON.stringify({ error: "simulated response loss" }),
        });
        return;
      }
      await route.continue();
    };

    try {
      await gotoAdminSection(page, "/admin/cards");
      await page.getByTestId("segmented-product").click();
      await page.getByTestId("admin-card-new").click();
      await page.getByTestId("card-editor-category").selectOption(category.id);
      await page.getByTestId("card-editor-title").fill(title);
      await page.getByTestId("card-editor-save").click();
      await expect(page).toHaveURL(ADMIN_CARD_EDIT_URL, { timeout: 15_000 });

      await page.getByTestId("card-editor-description").fill("Тестовое описание для recovery");
      await page.getByTestId("card-editor-price").fill("5000");
      await page.getByTestId("card-editor-price-unit").fill("за штуку");
      await page.getByTestId("card-editor-territory").selectOption({ index: 1 });
      await page.getByLabel("Форма собственности").selectOption({ index: 1 });
      await page.getByLabel("Местонахождение товара").selectOption({ index: 1 });
      await page.locator('input[type="file"]').setInputFiles(TEST_IMAGE);
      await expect(page.getByTestId("card-image-upload-status")).toHaveText("Фото готово к публикации.", {
        timeout: 20_000,
      });
      await expect(page.getByTestId("card-editor-publish")).toBeEnabled({ timeout: 20_000 });

      await page.route("**/admin/cards/*/publish", loseFirstPublishResponse);
      await page.getByTestId("card-editor-publish").click();
      await expect(page).toHaveURL(/\/admin\/cards$/, { timeout: 30_000 });
      expect(simulatedLostResponses).toBe(1);
      await page.getByTestId("segmented-product").click();
      const row = page.getByTestId("admin-card-row").filter({ hasText: title });
      await expect(row).toBeVisible({ timeout: 15_000 });
      const cardId = await row.getAttribute("data-card-id");
      expect(cardId).toBeTruthy();
      const reconciledCard = await api.get<{ publicationStatus: string; version: number }>(
        `/admin/cards/${cardId}`,
        adminSession,
      );
      expect(reconciledCard.publicationStatus).toBe("published");
    } finally {
      await page.unroute("**/admin/cards/*/publish", loseFirstPublishResponse);
    }
  });
});
