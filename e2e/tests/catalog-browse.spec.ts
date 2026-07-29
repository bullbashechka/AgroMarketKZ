import { expect, test } from "../fixtures/auth.fixture";

test.describe("Каталог: вкладки, поиск, фильтры, карточка", () => {
  test("услуги/товары, поиск, фильтр цены, переход в карточку", async ({ userPage: page }) => {
    await page.goto("/services");
    await expect(page.getByTestId("tab-services")).toBeVisible();
    await expect(page.getByTestId("card-tile").first()).toBeVisible({ timeout: 15_000 });

    await page.getByTestId("tab-products").click();
    await expect(page).toHaveURL(/\/products/);
    await expect(page.getByTestId("card-tile").first()).toBeVisible({ timeout: 15_000 });

    await page.getByTestId("category-filter-trigger").click();
    const firstCategory = page.getByTestId("category-filter-option").first();
    await expect(firstCategory).toBeVisible({ timeout: 15_000 });
    await firstCategory.click();
    await expect(page).toHaveURL(/\/products\/.+/);

    const firstCard = page.getByTestId("card-tile").first();
    await expect(firstCard).toBeVisible({ timeout: 15_000 });

    await page.getByTestId("category-filter-trigger").click();
    await page.getByTestId("category-filter-all").click();
    await expect(page).toHaveURL(/\/products$/);

    await page.getByTestId("price-filter-on_request").click();
    await page.getByTestId("price-filter-all").click();

    await page.getByTestId("search-input").fill("несуществующий-запрос-zzz");
    await expect(page.getByText(/ничего не найдено/i)).toBeVisible({ timeout: 5_000 });
    await page.getByTestId("search-input").fill("");

    await firstCard.click();
    await expect(page).toHaveURL(/\/products\/.+\/.+/);
    await expect(page.getByTestId("card-respond-button")).toBeVisible();
  });
});
