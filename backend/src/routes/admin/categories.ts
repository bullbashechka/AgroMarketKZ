import {
  adminCategoryListResponse,
  categoryListQuery,
  categorySchema,
  createCategoryInput,
  updateCategoryInput
} from "@agromarket/contracts";
import { Hono } from "hono";
import { z } from "zod";
import { getEnv, type HonoEnv } from "../../env";
import { HttpError } from "../../lib/errors";
import { createCategory, deleteCategory, listCategoriesAdmin, updateCategory } from "../../repos/adminCatalog";

export const adminCategoriesRoutes = new Hono<HonoEnv>();

/** Все категории вкладки (включая неактивные). */
adminCategoriesRoutes.get("/", async (c) => {
  const env = getEnv(c);
  const { type } = categoryListQuery.parse(c.req.query());
  const categories = await listCategoriesAdmin(env, type);
  return c.json(adminCategoryListResponse.parse(categories));
});

adminCategoriesRoutes.post("/", async (c) => {
  const env = getEnv(c);
  const input = createCategoryInput.parse(await c.req.json());
  const category = await createCategory(env, input);
  return c.json(categorySchema.parse(category), 201);
});

adminCategoriesRoutes.patch("/:id", async (c) => {
  const env = getEnv(c);
  const id = z.uuid().safeParse(c.req.param("id"));
  if (!id.success) {
    throw new HttpError(404, "Категория не найдена");
  }
  const input = updateCategoryInput.parse(await c.req.json());
  const category = await updateCategory(env, id.data, input);
  return c.json(categorySchema.parse(category));
});

/** Удаление категории. 409, если в ней ещё есть карточки. */
adminCategoriesRoutes.delete("/:id", async (c) => {
  const env = getEnv(c);
  const id = z.uuid().safeParse(c.req.param("id"));
  if (!id.success) {
    throw new HttpError(404, "Категория не найдена");
  }
  await deleteCategory(env, id.data);
  return c.body(null, 204);
});
