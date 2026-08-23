import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "../fixtures/auth.fixture";
import { deleteTestCard, deleteTestCategory } from "../helpers/api";
import { gotoAdminSection } from "../helpers/nav";

const TEST_IMAGE = path.join(path.dirname(fileURLToPath(import.meta.url)), "../fixtures/test-image.jpg");

test.describe("Админ — категории и карточки", () => {
  test("создание категории, создание и редактирование карточки", async ({ adminPage: page, adminToken }) => {
    test.setTimeout(90_000);
    const categoryName = `[e2e] Категория ${Date.now()}`;
    let categoryId: string | undefined;
    let cardId: string | undefined;

    await gotoAdminSection(page, "/admin/categories");
    await page.getByTestId("segmented-product").click();
    await page.getByTestId("admin-category-new").click();
    await page.getByTestId("admin-category-name-input").fill(categoryName);
    await page.getByTestId("admin-category-save").click();

    const categoryRow = page.getByTestId("admin-category-row").filter({ hasText: categoryName });
    await expect(categoryRow).toBeVisible({ timeout: 15_000 });
    categoryId = await categoryRow.getAttribute("data-category-id");

    await categoryRow.click();
    await page.getByRole("button", { name: "Обязательные характеристики" }).click();
    await page.getByTestId("admin-required-spec-add").click();
    await page.getByTestId("admin-required-spec-input").fill("Год выпуска");
    await page.getByTestId("admin-required-spec-save").click();

    await gotoAdminSection(page, "/admin/cards");
    await page.getByTestId("segmented-product").click();
    await page.getByTestId("admin-card-new").click();
    await page.getByTestId("card-editor-category").selectOption(categoryId!);
    const cardTitle = `[e2e] Карточка ${Date.now()}`;
    await page.getByTestId("card-editor-title").fill(cardTitle);
    await page.getByTestId("card-editor-save").click();

    await expect(page).toHaveURL(/\/admin\/cards\/.+/, { timeout: 15_000 });
    await expect(page.getByTestId("card-editor-publish")).toBeVisible({ timeout: 15_000 });
    await expect(page.locator('input[type="file"]')).toBeAttached();
    await page.getByTestId("card-editor-description").fill("Тестовое описание опубликованной карточки");
    await page.getByTestId("card-editor-price").fill("5000");
    await page.getByTestId("card-editor-price-unit").fill("за штуку");
    await page.getByTestId("card-editor-territory").selectOption({ index: 1 });
    await page.getByLabel("Форма собственности").selectOption({ index: 1 });
    await page.getByLabel("Местонахождение товара").selectOption({ index: 1 });
    await page.getByTestId("card-editor-availability").fill("В наличии");
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
    cardId = await cardRow.getAttribute("data-card-id");
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

    if (cardId) await deleteTestCard(adminToken, cardId);
    if (categoryId) await deleteTestCategory(adminToken, categoryId);
  });
});
