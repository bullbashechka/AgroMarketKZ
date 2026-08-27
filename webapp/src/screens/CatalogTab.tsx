import type { CatalogType } from "@agromarket/contracts";
import { useNavigate, useSearch } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { CardsList } from "../components/CardsList";
import { CategoryFilter } from "../components/CategoryFilter";
import { ListingSubmissionSheet } from "../components/ListingSubmissionSheet";
import { PriceFilter } from "../components/PriceFilter";
import { ProductFilters } from "../components/ProductFilters";
import { RegionFilter } from "../components/RegionFilter";
import { SearchBar } from "../components/SearchBar";
import { buildSearchQuery, type CatalogSearch } from "../lib/searchParams";
import { useCatalogRegion } from "../lib/catalogRegion";
import { tabRootPath, type TabSection } from "../lib/tabHistory";
import { useDebouncedValue } from "../lib/useDebouncedValue";

interface CatalogTabProps {
  type: CatalogType;
  section: TabSection;
  title: string;
}

/** Корень вкладки: лента всех карточек с поиском, ценой и компактным фильтром категории. */
export function CatalogTab({ type, section, title }: CatalogTabProps) {
  const search = useSearch({ strict: false }) as CatalogSearch;
  const navigate = useNavigate();
  const [inputValue, setInputValue] = useState(search.q ?? "");
  const debouncedQuery = useDebouncedValue(inputValue, 500);
  const [requestOpen, setRequestOpen] = useState(false);
  const { region: serviceRegion, setRegion } = useCatalogRegion();
  const region = type === "product" ? search.region ?? "all_regions" : serviceRegion;
  const ctaLabel = type === "product" ? "Продать объём" : "Опубликовать услугу";

  const activeQuery = search.q ?? "";

  useEffect(() => {
    const nextQuery = debouncedQuery.trim();
    if (nextQuery === activeQuery) return;
    void navigate({
      href: tabRootPath(section) + buildSearchQuery({ ...search, q: nextQuery || undefined }),
      replace: true
    });
  }, [debouncedQuery]);

  function handlePriceChange(price: CatalogSearch["price"]) {
    void navigate({ href: tabRootPath(section) + buildSearchQuery({ ...search, price }), replace: true });
  }

  return (
    <div className="screen">
      <div className="screen-header">
        <h2 className="screen-title">{title}</h2>
      </div>

      <SearchBar value={inputValue} onChange={setInputValue} placeholder={`Поиск по названию`} />
      {type === "product" ? <ProductFilters basePath={tabRootPath(section)} search={search} /> : <RegionFilter value={region} onChange={setRegion} />}
      <CategoryFilter type={type} section={section} search={search} />
      {type === "service" && <PriceFilter value={search.price} onChange={handlePriceChange} />}
      <CardsList
        type={type}
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
              <p>Ничего не найдено по запросу «{activeQuery}».</p>
              <button type="button" className="button button-secondary" onClick={() => setInputValue("")}>
                Сбросить поиск
              </button>
              <button type="button" className="button button-primary" onClick={() => setRequestOpen(true)}>
                {ctaLabel}
              </button>
            </div>
          ) : (
            <div className="empty-state">
              <p>Объявлений в этой вкладке пока нет.</p>
              <button type="button" className="button button-primary" onClick={() => setRequestOpen(true)}>
                {ctaLabel}
              </button>
            </div>
          )
        }
      />

      <button
        type="button"
        className="button button-primary tab-cta"
        data-testid="tab-request-cta"
        onClick={() => setRequestOpen(true)}
      >
        {ctaLabel}
      </button>

      <ListingSubmissionSheet
        open={requestOpen}
        onClose={() => setRequestOpen(false)}
        type={type}
      />
    </div>
  );
}
