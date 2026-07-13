import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "../fixtures/auth.fixture";
import { deleteTestCard, deleteTestCategory } from "../helpers/api";
import { gotoAdminSection } from "../helpers/nav";

const TEST_IMAGE = path.join(path.dirname(fileURLToPath(import.meta.url)), "../fixtures/test-image.jpg");

test.describe("Админ — категории и карточки", () => {
  test("создание категории, создание и редактирование карточки", async ({ adminPage: page, adminToken }) => {
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

    await gotoAdminSection(page, "/admin/cards");
    await page.getByTestId("segmented-product").click();
    await page.getByTestId("admin-card-new").click();
    await page.getByTestId("card-editor-category").selectOption(categoryId!);
    const cardTitle = `[e2e] Карточка ${Date.now()}`;
    await page.getByTestId("card-editor-title").fill(cardTitle);
    await page.getByTestId("card-editor-price").fill("5000");
    await page.locator('input[type="file"]').setInputFiles(TEST_IMAGE);
    await expect(page.getByTestId("card-editor-save")).toBeEnabled({ timeout: 20_000 });
    await page.getByTestId("card-editor-save").click();

    await expect(page).toHaveURL(/\/admin\/cards$/, { timeout: 15_000 });
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
