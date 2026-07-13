import { expect, test } from "../fixtures/auth.fixture";
import { api } from "../helpers/api";

interface CardListItem {
  id: string;
}

test.describe("Избранное", () => {
  test("добавление и удаление карточки из избранного", async ({ userPage: page, userToken }) => {
    const cards = await api.get<{ items: CardListItem[] }>("/catalog/cards?type=product&limit=1", userToken);
    const cardId = cards.items[0]?.id;
    test.skip(!cardId, "В каталоге нет карточек товаров для теста избранного");

    await api.delete(`/favorites/${cardId}`, userToken).catch(() => {});

    await page.goto(`/products/x/${cardId}`);
    const favoriteButton = page.getByTestId("favorite-toggle");
    await expect(favoriteButton).toBeVisible({ timeout: 15_000 });
    await expect(favoriteButton).toHaveAttribute("aria-pressed", "false");

    await favoriteButton.click();
    await expect(favoriteButton).toHaveAttribute("aria-pressed", "true");

    // Мутация оптимистична — ждём, пока запрос реально дойдёт до бэкенда, иначе полная
    // навигация на следующий экран может оборвать ещё не завершённый fetch.
    await expect(async () => {
      const favs = await api.get<CardListItem[]>("/favorites", userToken);
      expect(favs.some((f) => f.id === cardId)).toBe(true);
    }).toPass({ timeout: 10_000 });

    await page.goto("/general/favorites");
    await expect(page.getByTestId("card-tile").first()).toBeVisible({ timeout: 15_000 });

    await page.goto(`/products/x/${cardId}`);
    await expect(page.getByTestId("favorite-toggle")).toHaveAttribute("aria-pressed", "true", { timeout: 15_000 });
    await page.getByTestId("favorite-toggle").click();
    await expect(page.getByTestId("favorite-toggle")).toHaveAttribute("aria-pressed", "false");

    await api.delete(`/favorites/${cardId}`, userToken).catch(() => {});
  });
});
