import { expect, test } from "../fixtures/auth.fixture";
import { api } from "../helpers/api";

interface CardListItem {
  id: string;
}
interface AdminRequestItem {
  id: string;
  comment: string | null;
}

async function closeCreatedRequest(adminToken: string, marker: string) {
  for (const status of ["new", "in_progress", "closed"] as const) {
    const res = await api.get<{ items: AdminRequestItem[] }>(
      `/admin/requests?status=${status}&limit=50`,
      adminToken
    );
    const found = res.items?.find((r) => r.comment === marker);
    if (found) {
      await api.patch(`/admin/requests/${found.id}/status`, adminToken, { status: "closed" });
      return;
    }
  }
}

// Каждый тест логинится под своим свежим telegram id (freshUserPage), чтобы не делить
// общий rate-limit заявок (5/10 мин) с остальными спеками, использующими TEST_USER.
test.describe("Заявки — 3 источника", () => {
  test("первая заявка гостя атомарно сохраняет профиль и заявку", async ({
    unregisteredUserPage: page,
    adminToken,
  }) => {
    const marker = `[e2e] первая заявка гостя ${Date.now()}`;
    await page.goto("/products");
    await page.getByTestId("tab-request-cta").click();
    await page.getByTestId("request-name-input").fill("E2E Гость");
    await page.getByTestId("request-phone-input").fill("+77012223340");
    await page.locator("textarea").fill(marker);
    await page.getByTestId("request-submit").click();

    await expect(page.getByText(/заявка принята/i)).toBeVisible({ timeout: 15_000 });
    await page.getByRole("button", { name: "Продолжить просмотр" }).click();
    await page.goto("/general");
    await expect(page.getByRole("heading", { name: "Добро пожаловать, E2E Гость!" })).toBeVisible({ timeout: 15_000 });
    await closeCreatedRequest(adminToken, marker);
  });

  test("из карточки", async ({ freshUserPage: page, adminToken }) => {
    const cards = await api.get<{ items: CardListItem[] }>("/catalog/cards?type=product&limit=1", adminToken);
    const cardId = cards.items[0]?.id;
    test.skip(!cardId, "Нет карточек товаров для теста заявки");

    const marker = `[e2e] заявка из карточки ${Date.now()}`;
    await page.goto(`/products/x/${cardId}`);
    await page.getByTestId("card-respond-button").click();
    await page.getByTestId("response-request").click();

    await page.getByTestId("request-phone-input").fill("+77012223344");
    await page.locator("textarea").fill(marker);
    await page.getByTestId("request-submit").click();

    await expect(page.getByText(/заявка принята/i)).toBeVisible({ timeout: 15_000 });

    await closeCreatedRequest(adminToken, marker);
  });

  test("с вкладки", async ({ freshUserPage: page, adminToken }) => {
    const marker = `[e2e] заявка с вкладки ${Date.now()}`;
    await page.goto("/products");
    await page.getByTestId("tab-request-cta").click();

    await page.getByTestId("request-phone-input").fill("+77012223345");
    await page.locator("textarea").fill(marker);
    await page.getByTestId("request-submit").click();

    await expect(page.getByText(/заявка принята/i)).toBeVisible({ timeout: 15_000 });

    await closeCreatedRequest(adminToken, marker);
  });

  test("из профиля", async ({ freshUserPage: page, adminToken }) => {
    const marker = `[e2e] заявка из профиля ${Date.now()}`;
    await page.goto("/general");
    await page.getByTestId("tab-request-cta").click();

    await page.getByTestId("request-phone-input").fill("+77012223346");
    await page.locator("textarea").fill(marker);
    await page.getByTestId("request-submit").click();

    await expect(page.getByText(/заявка принята/i)).toBeVisible({ timeout: 15_000 });

    await closeCreatedRequest(adminToken, marker);
  });

  test("потерянный ответ и повторный submit создают одну заявку", async ({ freshUserPage: page, adminToken }) => {
    const marker = `[e2e] idempotency ${Date.now()}`;
    let intercepted = false;
    await page.route("**/requests", async (route) => {
      if (route.request().method() !== "POST" || intercepted) {
        await route.continue();
        return;
      }
      intercepted = true;
      await route.fetch();
      await route.abort("failed");
    });

    await page.goto("/products");
    await page.getByTestId("tab-request-cta").click();
    await page.locator("textarea").fill(marker);
    await page.getByTestId("request-submit").click();
    await expect(page.getByText(/не удалось отправить/i)).toBeVisible({ timeout: 15_000 });
    await page.getByTestId("request-submit").click();
    await expect(page.getByText(/заявка принята/i)).toBeVisible({ timeout: 15_000 });

    let matches = 0;
    for (const status of ["new", "in_progress", "closed"] as const) {
      const response = await api.get<{ items: AdminRequestItem[] }>(
        `/admin/requests?status=${status}&limit=50`,
        adminToken,
      );
      matches += response.items.filter((request) => request.comment === marker).length;
    }
    expect(matches).toBe(1);
    await closeCreatedRequest(adminToken, marker);
  });
});
