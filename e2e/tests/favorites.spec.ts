import { expect, test } from "../fixtures/auth.fixture";
import { api } from "../helpers/api";

interface CardListItem {
  id: string;
}

interface FavoritesResponse {
  items: CardListItem[];
  nextCursor: string | null;
}

function pagedFavorite(index: number): CardListItem & Record<string, unknown> {
  return {
    id: `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
    type: "product",
    categoryId: "00000000-0000-4000-8000-000000000001",
    title: `Избранное ${index}`,
    priceType: "fixed",
    priceAmount: 1_000,
    priceUnit: null,
    commodityGroup: null,
    volumeTonnes: null,
    imageUrl: null,
    shortSpec: null,
    territory: null,
    ownershipForm: null,
    productLocation: null,
    serviceAllKazakhstan: false,
    serviceTerritories: [],
  };
}

test.describe("Избранное", () => {
  test("добавление и удаление карточки из избранного", async ({ userPage: page, userSession }) => {
    const cards = await api.get<{ items: CardListItem[] }>("/catalog/cards?type=product&limit=1", userSession);
    const cardId = cards.items[0]?.id;
    test.skip(!cardId, "В каталоге нет карточек товаров для теста избранного");

    await api.delete(`/favorites/${cardId}`, userSession).catch(() => {});

    await page.goto(`/products/x/${cardId}`);
    const favoriteButton = page.getByTestId("favorite-toggle");
    await expect(favoriteButton).toBeVisible({ timeout: 15_000 });
    await expect(favoriteButton).toHaveAttribute("aria-pressed", "false");

    await favoriteButton.click();
    await expect(favoriteButton).toHaveAttribute("aria-pressed", "true");

    // Мутация оптимистична — ждём, пока запрос реально дойдёт до бэкенда, иначе полная
    // навигация на следующий экран может оборвать ещё не завершённый fetch.
    await expect(async () => {
      const favs = await api.get<FavoritesResponse>("/favorites?pagination=cursor", userSession);
      expect(favs.items.some((f) => f.id === cardId)).toBe(true);
    }).toPass({ timeout: 10_000 });

    await page.goto("/general/favorites");
    await expect(page.getByTestId("card-tile").first()).toBeVisible({ timeout: 15_000 });

    await page.goto(`/products/x/${cardId}`);
    await expect(page.getByTestId("favorite-toggle")).toHaveAttribute("aria-pressed", "true", { timeout: 15_000 });
    await page.getByTestId("favorite-toggle").click();
    await expect(page.getByTestId("favorite-toggle")).toHaveAttribute("aria-pressed", "false");

    await api.delete(`/favorites/${cardId}`, userSession).catch(() => {});
  });

  test("подгружает следующую cursor-страницу по кнопке", async ({ userPage: page }) => {
    const items = Array.from({ length: 21 }, (_value, index) => pagedFavorite(index + 1));
    await page.route("**/api/favorites?*", async (route) => {
      const url = new URL(route.request().url());
      if (url.searchParams.get("pagination") !== "cursor") return route.continue();
      const cursor = url.searchParams.get("cursor");
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify(cursor
          ? { items: items.slice(20), nextCursor: null }
          : { items: items.slice(0, 20), nextCursor: "next-page" }),
      });
    });

    await page.goto("/general/favorites");
    await expect(page.getByTestId("card-tile")).toHaveCount(20, { timeout: 15_000 });
    await page.getByRole("button", { name: "Показать ещё" }).click();
    await expect(page.getByTestId("card-tile")).toHaveCount(21);
  });
});
