import { expect, test } from "../fixtures/auth.fixture";
import { api } from "../helpers/api";

test("гость просматривает каталог, а регистрация возобновляет добавление в избранное", async ({
  unregisteredUserPage: page,
  adminToken,
}) => {
  await page.goto("/products");
  await expect(page.getByTestId("tab-products")).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId("register-name-input")).toHaveCount(0);

  const cards = await api.get<{ items: Array<{ id: string; categoryId: string }> }>(
    "/catalog/cards?type=product&limit=1",
    adminToken,
  );
  const card = cards.items[0];
  test.skip(!card, "Нет опубликованных карточек товаров");
  await page.goto(`/products/${card!.categoryId}/${card!.id}`);
  await page.getByTestId("favorite-toggle").click();

  await expect(page.getByTestId("register-name-input")).toBeVisible({ timeout: 15_000 });
  await page.getByTestId("register-name-input").fill("Айдос Тестов");
  await page.getByTestId("register-phone-input").fill("+77011234567");
  await page.getByTestId("register-submit").click();

  await expect(page.getByTestId("favorite-toggle")).toHaveAttribute("aria-pressed", "true", { timeout: 15_000 });
});
