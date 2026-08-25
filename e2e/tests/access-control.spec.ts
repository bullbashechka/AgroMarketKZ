import { expect, test } from "../fixtures/auth.fixture";
import { API_URL } from "../helpers/env";
import { gotoAdminSection } from "../helpers/nav";

test.describe("Разграничение доступа", () => {
  test("обычный пользователь не видит раздел «Управление» и получает 403 от admin API", async ({
    userPage: page,
    userSession
  }) => {
    await page.goto("/general");
    await expect(page.getByTestId("general-link-/admin/cards")).toHaveCount(0);

    const res = await fetch(`${API_URL}/admin/cards?type=product`, {
      headers: { cookie: userSession }
    });
    expect(res.status).toBe(403);
  });

  test("админ открывает админ-разделы", async ({ adminPage: page }) => {
    await gotoAdminSection(page, "/admin/cards");
    await expect(page).toHaveURL(/\/admin\/cards$/);
    await expect(page.getByTestId("admin-card-new")).toBeVisible({ timeout: 15_000 });
  });

  test("неавторизованный пользователь видит экран входа", async ({ page }) => {
    await page.context().clearCookies();
    await page.goto("/");
    await expect(page.getByText(/войдите через telegram/i)).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId("tab-services")).not.toBeVisible();
  });
});
