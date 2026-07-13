import type { CatalogType, CategoryListItem } from "@agromarket/contracts";
import { useQuery } from "@tanstack/react-query";
import { useNavigate, useSearch } from "@tanstack/react-router";
import { useEffect, useState, type MouseEvent } from "react";
import { CardsList } from "../components/CardsList";
import { ErrorState } from "../components/ErrorState";
import { PriceFilter } from "../components/PriceFilter";
import { RequestSheet } from "../components/RequestSheet";
import { SearchBar } from "../components/SearchBar";
import { SkeletonList } from "../components/Skeleton";
import { categoriesQueryOptions } from "../lib/queries";
import { buildSearchQuery, type CatalogSearch } from "../lib/searchParams";
import { tabRootPath, type TabSection } from "../lib/tabHistory";
import { useDebouncedValue } from "../lib/useDebouncedValue";

interface CatalogTabProps {
  type: CatalogType;
  section: TabSection;
  title: string;
}

/**
 * Корень вкладки: без поиска — грид категорий (с числом карточек); с поиском — карточки
 * по всей вкладке (не важно, в какой они категории), с фильтром по цене.
 */
export function CatalogTab({ type, section, title }: CatalogTabProps) {
  const search = useSearch({ strict: false }) as CatalogSearch;
  const navigate = useNavigate();
  const [inputValue, setInputValue] = useState(search.q ?? "");
  const debouncedQuery = useDebouncedValue(inputValue, 500);
  const [requestOpen, setRequestOpen] = useState(false);

  const categoriesQuery = useQuery(categoriesQueryOptions(type));
  const activeQuery = search.q ?? "";

  useEffect(() => {
    const nextQuery = debouncedQuery.trim();
    if (nextQuery === activeQuery) return;
    navigate({
      href: tabRootPath(section) + buildSearchQuery({ q: nextQuery || undefined, price: search.price }),
      replace: true
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedQuery]);

  function handlePriceChange(price: CatalogSearch["price"]) {
    navigate({ href: tabRootPath(section) + buildSearchQuery({ q: search.q, price }), replace: true });
  }

  return (
    <div className="screen">
      <div className="screen-header">
        <h2 className="screen-title">{title}</h2>
      </div>

      <SearchBar value={inputValue} onChange={setInputValue} placeholder={`Поиск по названию`} />

      {activeQuery ? (
        <>
          <PriceFilter value={search.price} onChange={handlePriceChange} />
          <CardsList
            type={type}
            search={activeQuery}
            price={search.price}
            emptyState={
              <div className="empty-state">
                <p>Ничего не найдено по запросу «{activeQuery}».</p>
                <button type="button" className="button button-secondary" onClick={() => setInputValue("")}>
                  Сбросить поиск
                </button>
                <button type="button" className="button button-primary" onClick={() => setRequestOpen(true)}>
                  Оставить заявку
                </button>
              </div>
            }
          />
        </>
      ) : (
        <>
          {categoriesQuery.isPending && <SkeletonList />}
          {categoriesQuery.isError && <ErrorState onRetry={categoriesQuery.refetch} />}
          {categoriesQuery.data && categoriesQuery.data.length === 0 && (
            <p className="muted">Категории пока не добавлены.</p>
          )}
          {categoriesQuery.data && categoriesQuery.data.length > 0 && (
            <div className="grid-cards">
              {categoriesQuery.data.map((category) => (
                <CategoryChip key={category.id} category={category} section={section} />
              ))}
            </div>
          )}
        </>
      )}

      <button
        type="button"
        className="button button-primary tab-cta"
        data-testid="tab-request-cta"
        onClick={() => setRequestOpen(true)}
      >
        Оставить заявку
      </button>

      <RequestSheet
        open={requestOpen}
        onClose={() => setRequestOpen(false)}
        source={{ source: "tab", tabType: type }}
      />
    </div>
  );
}

function CategoryChip({ category, section }: { category: CategoryListItem; section: TabSection }) {
  const navigate = useNavigate();
  const href = `${tabRootPath(section)}/${category.id}`;

  function handleClick(event: MouseEvent<HTMLAnchorElement>) {
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return;
    event.preventDefault();
    navigate({ href });
  }

  return (
    <a href={href} className="category-chip" data-testid="category-chip" data-category-id={category.id} onClick={handleClick}>
      <span>{category.name}</span>
      <span className="category-chip-count">{category.cardCount}</span>
    </a>
  );
}
