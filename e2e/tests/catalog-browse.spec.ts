import { expect, test } from "../fixtures/auth.fixture";

test.describe("Каталог: вкладки, поиск, фильтры, карточка", () => {
  test("товары открываются первыми; поиск, фильтры и переход в карточку работают", async ({ userPage: page }) => {
    await page.goto("/");
    await expect(page).toHaveURL(/\/products/);
    await expect(page.getByTestId("tab-products")).toBeVisible();
    await expect(page.getByTestId("card-tile").first()).toBeVisible({ timeout: 15_000 });

    await page.getByRole("button", { name: /Фильтры и сортировка/ }).click();
    await page.getByLabel("Область").selectOption("kostanay_region");
    await page.getByRole("button", { name: "Показать товары", exact: true }).click();
    await expect(page.getByText("Б/у трактор 150 л.с.", { exact: true })).toBeVisible();
    await expect(page.getByText("Семена пшеницы Астана-2", { exact: true })).toHaveCount(0);

    await page.getByTestId("tab-services").click();
    await expect(page).toHaveURL(/\/services/);
    await expect(page.getByText("Консультация агронома", { exact: true })).toBeVisible();
    await expect(page.getByText("Перевозка зерна по Казахстану", { exact: true })).toBeVisible();
    await expect(page.getByText("Выездной ремонт сельхозтехники", { exact: true })).toBeVisible();

    await page.getByTestId("region-filter-trigger").click();
    await page.getByRole("button", { name: "Северо-Казахстанская область", exact: true }).click();
    await expect(page.getByText("Консультация агронома", { exact: true })).toBeVisible();
    await expect(page.getByText("Перевозка зерна по Казахстану", { exact: true })).toBeVisible();
    await expect(page.getByText("Выездной ремонт сельхозтехники", { exact: true })).toHaveCount(0);

    await page.getByTestId("tab-products").click();
    await expect(page).toHaveURL(/\/products/);
    await expect(page.getByText("Семена пшеницы Астана-2", { exact: true })).toBeVisible();

    await page.getByRole("button", { name: /Фильтры и сортировка/ }).click();
    await page.getByLabel("Область").selectOption("all_regions");
    await page.getByRole("button", { name: "Показать товары", exact: true }).click();

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

    await page.getByTestId("search-input").fill("несуществующий-запрос-zzz");
    await expect(page.getByText(/ничего не найдено/i)).toBeVisible({ timeout: 5_000 });
    await page.getByTestId("search-input").fill("");

    await firstCard.click();
    await expect(page).toHaveURL(/\/products\/.+\/.+/);
    await expect(page.getByTestId("card-respond-button")).toBeVisible();
  });
});
