import type { CatalogType } from "@agromarket/contracts";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { buildSearchQuery, type CatalogSearch } from "../lib/searchParams";
import { categoriesQueryOptions } from "../lib/queries";
import { tabRootPath, type TabSection } from "../lib/tabHistory";
import { BottomSheet } from "./BottomSheet";
import { ErrorState } from "./ErrorState";
import { SkeletonList } from "./Skeleton";

interface CategoryFilterProps {
  type: CatalogType;
  section: TabSection;
  selectedCategoryId?: string;
  search: CatalogSearch;
}

/** Компактный фильтр категорий: кнопка на экране и полный список в нижней шторке. */
export function CategoryFilter({ type, section, selectedCategoryId, search }: CategoryFilterProps) {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const categoriesQuery = useQuery(categoriesQueryOptions(type));
  const categories = categoriesQuery.data ?? [];
  const selectedCategory = categories.find((category) => category.id === selectedCategoryId);
  const totalCardCount = categories.reduce((total, category) => total + category.cardCount, 0);
  const label = selectedCategory?.name ?? "Все категории";

  function selectCategory(categoryId?: string) {
    setOpen(false);
    const path = categoryId ? `${tabRootPath(section)}/${categoryId}` : tabRootPath(section);
    void navigate({ href: path + buildSearchQuery(search) });
  }

  return (
    <>
      <button
        type="button"
        className="category-filter-trigger"
        data-testid="category-filter-trigger"
        onClick={() => setOpen(true)}
        disabled={categoriesQuery.isPending}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={`Выбрать категорию. Сейчас: ${label}`}
      >
        <svg className="category-filter-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
          <path d="M4 6h16M7 12h10M10 18h4" strokeLinecap="round" />
        </svg>
        <span className="category-filter-label">{label}</span>
        <svg className="category-filter-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
          <path d="m7 10 5 5 5-5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>

      <BottomSheet open={open} onClose={() => setOpen(false)}>
        <section className="category-sheet" aria-label="Выбор категории">
          <h2 className="screen-title">Категории</h2>
          {categoriesQuery.isPending && <SkeletonList rows={4} />}
          {categoriesQuery.isError && <ErrorState onRetry={categoriesQuery.refetch} />}
          {categoriesQuery.data && (
            <div className="category-sheet-options" role="group" aria-label="Категории объявлений">
              <button
                type="button"
                className={`category-sheet-option${!selectedCategoryId ? " category-sheet-option--selected" : ""}`}
                data-testid="category-filter-all"
                aria-pressed={!selectedCategoryId}
                onClick={() => selectCategory()}
              >
                <span>Все категории</span>
                <span className="category-sheet-count">{totalCardCount}</span>
              </button>
              {categories.map((category) => (
                <button
                  key={category.id}
                  type="button"
                  className={`category-sheet-option${category.id === selectedCategoryId ? " category-sheet-option--selected" : ""}`}
                  data-testid="category-filter-option"
                  data-category-id={category.id}
                  aria-pressed={category.id === selectedCategoryId}
                  onClick={() => selectCategory(category.id)}
                >
                  <span>{category.name}</span>
                  <span className="category-sheet-count">{category.cardCount}</span>
                </button>
              ))}
            </div>
          )}
        </section>
      </BottomSheet>
    </>
  );
}
