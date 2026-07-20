import { expect, test } from "../fixtures/auth.fixture";
import { api } from "../helpers/api";
import { TELEGRAM_BOT_TOKEN } from "../helpers/env";
import { gotoAdminSection } from "../helpers/nav";
import { loginAsTelegramUser } from "../helpers/telegramAuth";

test.describe("Админ — смена статуса заявки", () => {
  test("новая заявка появляется в списке и меняет статус", async ({ adminPage: page, adminToken }) => {
    // Свежий telegram id — не делит rate-limit заявок с TEST_USER, которого используют другие спеки.
    const freshUser = { id: Math.floor(900_300_000 + Math.random() * 100_000), first_name: "E2E", last_name: "Status" };
    const { token: freshUserToken } = await loginAsTelegramUser(
      process.env.E2E_API_URL ?? "http://localhost:3000",
      TELEGRAM_BOT_TOKEN,
      freshUser
    );
    await api.post("/profile/register", freshUserToken, { contactName: "E2E Статус", contactPhone: "+77019998877" });

    const marker = `[e2e] статус-тест ${Date.now()}`;
    const created = await api.post<{ id: string }>("/requests", freshUserToken, {
      clientRequestId: crypto.randomUUID(),
      source: "profile",
      contactName: "E2E Статус",
      contactPhone: "+77019998877",
      comment: marker
    });

    await gotoAdminSection(page, "/admin/requests");
    await page.getByTestId("segmented-new").click();
    const row = page.getByTestId("admin-request-row").filter({ hasText: marker });
    await expect(row).toBeVisible({ timeout: 15_000 });
    await expect(row.getByTestId("request-status-value")).toHaveText(/новая/i);

    await row.getByTestId("request-status-next").click();

    // Список фильтруется по статусу — после смены "новая" → "в работе" заявка уходит
    // из вкладки «Новые», поэтому проверяем её появление во вкладке «В работе».
    await page.getByTestId("segmented-in_progress").click();
    const movedRow = page.getByTestId("admin-request-row").filter({ hasText: marker });
    await expect(movedRow).toBeVisible({ timeout: 15_000 });
    await expect(movedRow.getByTestId("request-status-value")).toHaveText(/в работе/i);

    await api.patch(`/admin/requests/${created.id}/status`, adminToken, { status: "closed" });
  });
});
