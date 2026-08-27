import {
  adminCategoryListResponse,
  categoryListQuery,
  categorySchema,
  createCategoryInput,
  updateCategoryInput
} from "@agromarket/contracts";
import { Hono } from "hono";
import { z } from "zod";
import { getDatabase, getEnv, type HonoEnv } from "../../env";
import { runAdminMutation } from "../../lib/adminAuditRequest";
import { HttpError } from "../../lib/errors";
import { createCategory, deleteCategory, listCategoriesAdmin, updateCategory } from "../../repos/adminCategories";

export const adminCategoriesRoutes = new Hono<HonoEnv>();

/** Все категории вкладки (включая неактивные). */
adminCategoriesRoutes.get("/", async (c) => {
  const env = getEnv(c);
  const { type } = categoryListQuery.parse(c.req.query());
  const categories = await listCategoriesAdmin(env, type, getDatabase(c));
  return c.json(adminCategoryListResponse.parse(categories));
});

adminCategoriesRoutes.post("/", async (c) => {
  const env = getEnv(c);
  const input = createCategoryInput.parse(await c.req.json());
  const category = await runAdminMutation(c, 201, (audit) => createCategory(env, input, getDatabase(c), audit));
  return c.json(categorySchema.parse(category), 201);
});

adminCategoriesRoutes.patch("/:id", async (c) => {
  const env = getEnv(c);
  const id = z.uuid().safeParse(c.req.param("id"));
  if (!id.success) {
    throw new HttpError(404, "Категория не найдена");
  }
  const input = updateCategoryInput.parse(await c.req.json());
  const category = await runAdminMutation(c, 200, (audit) => updateCategory(env, id.data, input, getDatabase(c), audit));
  return c.json(categorySchema.parse(category));
});

/** Удаление категории. 409, если в ней ещё есть карточки. */
adminCategoriesRoutes.delete("/:id", async (c) => {
  const env = getEnv(c);
  const id = z.uuid().safeParse(c.req.param("id"));
  if (!id.success) {
    throw new HttpError(404, "Категория не найдена");
  }
  await runAdminMutation(c, 204, (audit) => deleteCategory(env, id.data, getDatabase(c), audit));
  return c.body(null, 204);
});
