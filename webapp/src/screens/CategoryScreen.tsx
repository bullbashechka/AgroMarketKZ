import type { CatalogType } from "@agromarket/contracts";
import { useNavigate, useParams, useSearch } from "@tanstack/react-router";
import { useEffect, useState, type MouseEvent } from "react";
import { CardsList } from "../components/CardsList";
import { CategoryFilter } from "../components/CategoryFilter";
import { ListingSubmissionSheet } from "../components/ListingSubmissionSheet";
import { PriceFilter } from "../components/PriceFilter";
import { ProductFilters } from "../components/ProductFilters";
import { RegionFilter } from "../components/RegionFilter";
import { Screen } from "../components/Screen";
import { SearchBar } from "../components/SearchBar";
import { buildSearchQuery, type CatalogSearch } from "../lib/searchParams";
import { useCatalogRegion } from "../lib/catalogRegion";
import { tabRootPath, type TabSection } from "../lib/tabHistory";
import { useDebouncedValue } from "../lib/useDebouncedValue";

interface CategoryScreenProps {
  type: CatalogType;
  section: TabSection;
}

/** Второй уровень стека вкладки: карточки выбранной категории с поиском и фильтром цены. */
export function CategoryScreen({ type, section }: CategoryScreenProps) {
  const { categoryId } = useParams({ strict: false }) as { categoryId: string };
  const search = useSearch({ strict: false }) as CatalogSearch;
  const navigate = useNavigate();
  const [inputValue, setInputValue] = useState(search.q ?? "");
  const debouncedQuery = useDebouncedValue(inputValue, 500);
  const [requestOpen, setRequestOpen] = useState(false);
  const { region: serviceRegion, setRegion } = useCatalogRegion();
  const region = type === "product" ? search.region ?? "all_regions" : serviceRegion;
  const ctaLabel = type === "product" ? "Продать объём" : "Опубликовать услугу";

  const basePath = `${tabRootPath(section)}/${categoryId}`;
  const activeQuery = search.q ?? "";

  useEffect(() => {
    const nextQuery = debouncedQuery.trim();
    if (nextQuery === activeQuery) return;
    navigate({
      href: basePath + buildSearchQuery({ ...search, q: nextQuery || undefined }),
      replace: true
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedQuery]);

  function handlePriceChange(price: CatalogSearch["price"]) {
    navigate({ href: basePath + buildSearchQuery({ ...search, price }), replace: true });
  }

  function goToWholeTab(event: MouseEvent) {
    event.preventDefault();
    navigate({ href: tabRootPath(section) + buildSearchQuery({ ...search, q: activeQuery || undefined }) });
  }

  return (
    <Screen back fallbackTo={tabRootPath(section)}>
      <SearchBar value={inputValue} onChange={setInputValue} />
      {type === "product" ? <ProductFilters basePath={basePath} search={search} /> : <RegionFilter value={region} onChange={setRegion} />}
      <CategoryFilter type={type} section={section} selectedCategoryId={categoryId} search={search} />
      {type === "service" && <PriceFilter value={search.price} onChange={handlePriceChange} />}

      <CardsList
        type={type}
        categoryId={categoryId}
        search={activeQuery || undefined}
        price={search.price}
        region={region}
        sort={search.sort}
        commodityGroups={search.commodityGroups}
        ownershipForms={search.ownershipForms}
        productLocation={search.productLocation}
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
                {ctaLabel}
              </button>
            </div>
          ) : (
            <div className="empty-state">
              <p>В этой категории пока нет карточек.</p>
              <button type="button" className="button button-primary" onClick={() => setRequestOpen(true)}>
                {ctaLabel}
              </button>
            </div>
          )
        }
      />

      <ListingSubmissionSheet
        open={requestOpen}
        onClose={() => setRequestOpen(false)}
        type={type}
      />
    </Screen>
  );
}
