import { z } from "zod";

// Значения совпадают со строками enum-типов в БД (см. database/migrations/0001_initial_schema.sql).
// Русские подписи живут здесь же — единый источник правды для отображения.

export const catalogTypeSchema = z.enum(["product", "service"]);
export type CatalogType = z.infer<typeof catalogTypeSchema>;

export const priceTypeSchema = z.enum(["fixed", "on_request"]);
export type PriceType = z.infer<typeof priceTypeSchema>;

export const requestSourceSchema = z.enum(["card", "tab", "profile"]);
export type RequestSource = z.infer<typeof requestSourceSchema>;

export const requestStatusSchema = z.enum(["new", "in_progress", "closed"]);
export type RequestStatus = z.infer<typeof requestStatusSchema>;

// Подписи для интерфейса (RU)
export const catalogTypeLabels: Record<CatalogType, string> = {
  product: "Товар",
  service: "Услуга"
};

export const catalogTypeTabLabels: Record<CatalogType, string> = {
  product: "Товары",
  service: "Услуги"
};

export const priceTypeLabels: Record<PriceType, string> = {
  fixed: "Фиксированная цена",
  on_request: "Цена по запросу"
};

export const requestSourceLabels: Record<RequestSource, string> = {
  card: "Из карточки",
  tab: "С вкладки",
  profile: "Из профиля"
};

export const requestStatusLabels: Record<RequestStatus, string> = {
  new: "Новая",
  in_progress: "В работе",
  closed: "Закрыта"
};
