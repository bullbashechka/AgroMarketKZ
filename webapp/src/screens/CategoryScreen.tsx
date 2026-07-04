import type { CatalogType } from "@agromarket/contracts";
import { useQuery } from "@tanstack/react-query";
import { useNavigate, useParams, useSearch } from "@tanstack/react-router";
import { useEffect, useState, type MouseEvent } from "react";
import { CardsList } from "../components/CardsList";
import { PriceFilter } from "../components/PriceFilter";
import { RequestSheet } from "../components/RequestSheet";
import { Screen } from "../components/Screen";
import { SearchBar } from "../components/SearchBar";
import { categoriesQueryOptions } from "../lib/queries";
import { buildSearchQuery, type CatalogSearch } from "../lib/searchParams";
import { tabRootPath, type TabSection } from "../lib/tabHistory";
import { useDebouncedValue } from "../lib/useDebouncedValue";

interface CategoryScreenProps {
  type: CatalogType;
  section: TabSection;
}

/** Второй уровень стека вкладки: карточки категории с поиском (+ фолбэк на всю вкладку) и фильтром цены. */
export function CategoryScreen({ type, section }: CategoryScreenProps) {
  const { categoryId } = useParams({ strict: false }) as { categoryId: string };
  const search = useSearch({ strict: false }) as CatalogSearch;
  const navigate = useNavigate();
  const [inputValue, setInputValue] = useState(search.q ?? "");
  const debouncedQuery = useDebouncedValue(inputValue, 500);
  const [requestOpen, setRequestOpen] = useState(false);

  const { data: categories } = useQuery(categoriesQueryOptions(type));
  const category = categories?.find((c) => c.id === categoryId);
  const basePath = `${tabRootPath(section)}/${categoryId}`;
  const activeQuery = search.q ?? "";

  useEffect(() => {
    const nextQuery = debouncedQuery.trim();
    if (nextQuery === activeQuery) return;
    navigate({
      href: basePath + buildSearchQuery({ q: nextQuery || undefined, price: search.price }),
      replace: true
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedQuery]);

  function handlePriceChange(price: CatalogSearch["price"]) {
    navigate({ href: basePath + buildSearchQuery({ q: search.q, price }), replace: true });
  }

  function goToWholeTab(event: MouseEvent) {
    event.preventDefault();
    navigate({ href: tabRootPath(section) + buildSearchQuery({ q: activeQuery }) });
  }

  return (
    <Screen back title={category?.name ?? "Категория"} fallbackTo={tabRootPath(section)}>
      <SearchBar value={inputValue} onChange={setInputValue} />
      <PriceFilter value={search.price} onChange={handlePriceChange} />

      <CardsList
        type={type}
        categoryId={categoryId}
        search={activeQuery || undefined}
        priceType={search.price}
        emptyState={
          activeQuery ? (
            <div className="empty-state">
              <p>Ничего не найдено по запросу «{activeQuery}» в этой категории.</p>
              <a className="button button-secondary" href={tabRootPath(section)} onClick={goToWholeTab}>
                Искать во всей вкладке «{activeQuery}»
              </a>
              <button type="button" className="button button-secondary" onClick={() => setInputValue("")}>
                Сбросить поиск
              </button>
              <button type="button" className="button button-primary" onClick={() => setRequestOpen(true)}>
                Оставить заявку
              </button>
            </div>
          ) : (
            <div className="empty-state">
              <p>В этой категории пока нет карточек.</p>
              <button type="button" className="button button-primary" onClick={() => setRequestOpen(true)}>
                Оставить заявку
              </button>
            </div>
          )
        }
      />

      <RequestSheet
        open={requestOpen}
        onClose={() => setRequestOpen(false)}
        source={{ source: "tab", tabType: type }}
      />
    </Screen>
  );
}
