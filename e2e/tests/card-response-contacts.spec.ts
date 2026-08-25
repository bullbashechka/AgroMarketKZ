import { expect, test } from "../fixtures/auth.fixture";
import { api } from "../helpers/api";

interface CardListItem {
  id: string;
}

test.describe("Отклик — контакты", () => {
  test("шторка отклика показывает контакты и открывает внешние ссылки", async ({ userPage: page, userSession }) => {
    const cards = await api.get<{ items: CardListItem[] }>("/catalog/cards?type=product&limit=1", userSession);
    const cardId = cards.items[0]?.id;
    test.skip(!cardId, "В каталоге нет карточек товаров для теста отклика");

    // Реальный Telegram WebApp SDK вне Telegram ведёт себя недетерминированно (иногда popup,
    // иногда навигация в том же окне, иногда собственный конфирм). Блокируем загрузку внешнего
    // SDK-скрипта — это ровно сценарий «обычный браузер» (Этап 3/5), тогда openExternalLink/
    // openTelegramDeepLink детерминированно используют window.open, и popup всегда открывается.
    await page.route("https://telegram.org/js/telegram-web-app.js", (route) => route.abort());

    await page.goto(`/products/x/${cardId}`);
    await page.getByTestId("card-respond-button").click();

    await expect(page.getByTestId("response-phone")).toBeVisible({ timeout: 10_000 });
    const externalRequests: string[] = [];
    page.context().on("request", (request) => externalRequests.push(request.url()));

    const [whatsappPopup] = await Promise.all([
      page.waitForEvent("popup", { timeout: 15_000 }),
      page.getByTestId("response-whatsapp").click()
    ]);
    expect(whatsappPopup.url()).toMatch(/whatsapp|wa\.me/);
    await whatsappPopup.close();

    const [telegramPopup] = await Promise.all([
      page.waitForEvent("popup", { timeout: 15_000 }),
      page.getByTestId("response-telegram").click()
    ]);
    await expect.poll(
      () => externalRequests.some((url) => /t\.me|telegram/.test(url)),
      { timeout: 10_000 },
    ).toBe(true);
    await telegramPopup.close();

    await expect(page.getByTestId("response-request")).toBeVisible();
  });
});
