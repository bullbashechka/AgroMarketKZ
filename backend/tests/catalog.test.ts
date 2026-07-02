import { describe, expect, test } from "bun:test";
import type { AppEnv } from "../src/env";
import {
  toCardDetail,
  toCardListItem,
  toCategory,
  type CardImageRow,
  type CardListRow,
  type CardRow,
  type CardSpecRow,
  type CategoryRow
} from "../src/repos/catalog";

const env = {
  SUPABASE_URL: "https://qxyieyzfdcosmmckyocm.supabase.co",
  SUPABASE_STORAGE_BUCKET: "card-images"
} as AppEnv;

describe("toCategory", () => {
  test("маппит строку БД в DTO категории", () => {
    const row: CategoryRow = {
      id: "cat-1",
      type: "product",
      name: "Зерно",
      sort_order: 2,
      is_active: true,
      created_at: new Date("2026-01-01T00:00:00.000Z"),
      updated_at: new Date("2026-01-02T00:00:00.000Z")
    };
    expect(toCategory(row)).toEqual({
      id: "cat-1",
      type: "product",
      name: "Зерно",
      sortOrder: 2,
      isActive: true,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-02T00:00:00.000Z"
    });
  });
});

describe("toCardListItem", () => {
  const base: CardListRow = {
    id: "card-1",
    type: "product",
    category_id: "cat-1",
    title: "Мини-трактор МТЗ-82",
    price_type: "fixed",
    price_amount: 5_000_000,
    first_image_path: null,
    first_spec_key: null,
    first_spec_value: null
  };

  test("цена «по запросу» — priceAmount null", () => {
    const row: CardListRow = { ...base, price_type: "on_request", price_amount: null };
    expect(toCardListItem(row, env).priceAmount).toBeNull();
    expect(toCardListItem(row, env).priceType).toBe("on_request");
  });

  test("без фото — imageUrl null", () => {
    expect(toCardListItem(base, env).imageUrl).toBeNull();
  });

  test("с фото — imageUrl собран через publicImageUrl", () => {
    const row: CardListRow = { ...base, first_image_path: "cards/card-1/1.jpg" };
    expect(toCardListItem(row, env).imageUrl).toBe(
      "https://qxyieyzfdcosmmckyocm.supabase.co/storage/v1/object/public/card-images/cards/card-1/1.jpg"
    );
  });

  test("без характеристик — shortSpec null", () => {
    expect(toCardListItem(base, env).shortSpec).toBeNull();
  });

  test("с характеристикой — shortSpec «ключ: значение»", () => {
    const row: CardListRow = { ...base, first_spec_key: "Мощность", first_spec_value: "82 л.с." };
    expect(toCardListItem(row, env).shortSpec).toBe("Мощность: 82 л.с.");
  });
});

describe("toCardDetail", () => {
  const row: CardRow = {
    id: "card-1",
    type: "product",
    category_id: "cat-1",
    title: "Мини-трактор МТЗ-82",
    description: "Надёжный трактор",
    price_type: "fixed",
    price_amount: 5_000_000,
    sort_order: 0,
    archived_at: null,
    created_at: new Date("2026-01-01T00:00:00.000Z"),
    updated_at: new Date("2026-01-02T00:00:00.000Z")
  };
  const images: CardImageRow[] = [
    { id: "img-1", storage_path: "cards/card-1/1.jpg", alt_text: null, sort_order: 0 }
  ];
  const specs: CardSpecRow[] = [{ id: "spec-1", key: "Мощность", value: "82 л.с.", sort_order: 0 }];

  test("активная карточка — archivedAt null", () => {
    expect(toCardDetail(row, images, specs, env).archivedAt).toBeNull();
  });

  test("архивная карточка — archivedAt в ISO", () => {
    const archived: CardRow = { ...row, archived_at: new Date("2026-03-01T00:00:00.000Z") };
    expect(toCardDetail(archived, images, specs, env).archivedAt).toBe("2026-03-01T00:00:00.000Z");
  });

  test("собирает галерею с публичными URL и характеристики", () => {
    const detail = toCardDetail(row, images, specs, env);
    expect(detail.images).toEqual([
      {
        id: "img-1",
        storagePath: "cards/card-1/1.jpg",
        url: "https://qxyieyzfdcosmmckyocm.supabase.co/storage/v1/object/public/card-images/cards/card-1/1.jpg",
        altText: null,
        sortOrder: 0
      }
    ]);
    expect(detail.specs).toEqual([{ id: "spec-1", key: "Мощность", value: "82 л.с.", sortOrder: 0 }]);
  });

  test("карточка без фото и характеристик — пустые массивы", () => {
    const detail = toCardDetail(row, [], [], env);
    expect(detail.images).toEqual([]);
    expect(detail.specs).toEqual([]);
  });
});
