import {
  commodityGroupLabels,
  productLocationLabels,
  productOwnershipFormLabels,
  productSortLabels,
  type CommodityGroup,
  type ProductLocation,
  type ProductOwnershipForm,
  type ProductSort,
  type Territory,
} from "@agromarket/contracts";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { buildSearchQuery, type CatalogSearch } from "../lib/searchParams";
import { territoriesQueryOptions } from "../lib/queries";
import { BottomSheet } from "./BottomSheet";
import { ErrorState } from "./ErrorState";
import { SkeletonList } from "./Skeleton";

interface ProductFiltersProps {
  basePath: string;
  search: CatalogSearch;
}

const groups = Object.entries(commodityGroupLabels) as [CommodityGroup, string][];
const ownershipForms = Object.entries(productOwnershipFormLabels) as [ProductOwnershipForm, string][];
const locations: Array<{ value: ProductLocation | "all"; label: string }> = [
  { value: "all", label: "Все" },
  { value: "elevator", label: productLocationLabels.elevator },
  { value: "seller_site", label: productLocationLabels.seller_site },
];
const sorts = Object.entries(productSortLabels) as [ProductSort, string][];

function territoryLabel(value: CatalogSearch["region"], territories: Territory[]): string {
  if (!value || value === "all_regions") return "Все области";
  return territories.find((territory) => territory.code === value)?.name ?? "Все области";
}

/** Единая товарная шторка: область, место, группа, форма собственности и сортировка. */
export function ProductFilters({ basePath, search }: ProductFiltersProps) {
  const [open, setOpen] = useState(false);
  const territoriesQuery = useQuery(territoriesQueryOptions);
  const navigate = useNavigate();
  const territories = territoriesQuery.data ?? [];
  const [draft, setDraft] = useState<CatalogSearch>(search);
  const activeCount = (search.region && search.region !== "all_regions" ? 1 : 0)
    + (search.sort ? 1 : 0)
    + (search.commodityGroups?.length ?? 0)
    + (search.ownershipForms?.length ?? 0)
    + (search.productLocation ? 1 : 0);

  function openSheet() {
    setDraft(search);
    setOpen(true);
  }

  function apply() {
    setOpen(false);
    void navigate({ href: basePath + buildSearchQuery(draft), replace: true });
  }

  function reset() {
    setDraft({ q: search.q });
  }

  const regions = territories.filter((territory) => territory.kind === "region");

  return (
    <>
      <button type="button" className="category-filter-trigger" onClick={openSheet} aria-haspopup="dialog" aria-expanded={open}>
        <span className="category-filter-label">Фильтры и сортировка{activeCount > 0 ? ` · ${activeCount}` : ""}</span>
        <span aria-hidden="true">⌄</span>
      </button>
      <BottomSheet open={open} onClose={() => setOpen(false)}>
        <section className="category-sheet" aria-label="Фильтры и сортировка товаров">
          <h2 className="screen-title">Фильтры и сортировка</h2>
          {territoriesQuery.isPending && <SkeletonList rows={4} />}
          {territoriesQuery.isError && <ErrorState onRetry={territoriesQuery.refetch} />}
          {territoriesQuery.data && (
            <div className="form">
              <label className="field">
                <span className="field-label">Область</span>
                <select className="input" value={draft.region ?? "all_regions"} onChange={(event) => setDraft({ ...draft, region: event.target.value as CatalogSearch["region"] })}>
                  <option value="all_regions">Все области</option>
                  {regions.map((territory) => <option key={territory.code} value={territory.code}>{territory.name}</option>)}
                </select>
              </label>

              <fieldset className="field">
                <legend className="field-label">Место товара</legend>
                <div className="filter-seg" role="tablist" aria-label="Место товара">
                  {locations.map((location) => (
                    <button
                      key={location.value}
                      type="button"
                      role="tab"
                      aria-selected={(draft.productLocation ?? "all") === location.value}
                      className={`filter-seg-item${(draft.productLocation ?? "all") === location.value ? " filter-seg-item--active" : ""}`}
                      onClick={() => setDraft({ ...draft, productLocation: location.value === "all" ? undefined : location.value })}
                    >
                      {location.label}
                    </button>
                  ))}
                </div>
              </fieldset>

              <fieldset className="field">
                <legend className="field-label">Группа продукции</legend>
                {groups.map(([value, label]) => (
                  <label className="check-row" key={value}>
                    <input
                      type="checkbox"
                      checked={draft.commodityGroups?.includes(value) ?? false}
                      onChange={() => setDraft({
                        ...draft,
                        commodityGroups: draft.commodityGroups?.includes(value)
                          ? draft.commodityGroups.filter((item) => item !== value)
                          : [...(draft.commodityGroups ?? []), value],
                      })}
                    />
                    <span>{label}</span>
                  </label>
                ))}
              </fieldset>

              <fieldset className="field">
                <legend className="field-label">Форма собственности</legend>
                {ownershipForms.map(([value, label]) => (
                  <label className="check-row" key={value}>
                    <input
                      type="checkbox"
                      checked={draft.ownershipForms?.includes(value) ?? false}
                      onChange={() => setDraft({
                        ...draft,
                        ownershipForms: draft.ownershipForms?.includes(value)
                          ? draft.ownershipForms.filter((item) => item !== value)
                          : [...(draft.ownershipForms ?? []), value],
                      })}
                    />
                    <span>{label}</span>
                  </label>
                ))}
              </fieldset>

              <label className="field">
                <span className="field-label">Сортировка</span>
                <select className="input" value={draft.sort ?? "default"} onChange={(event) => setDraft({ ...draft, sort: event.target.value as ProductSort })}>
                  {sorts.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                </select>
              </label>

              <div className="sheet-actions">
                <button type="button" className="button button-primary" onClick={apply}>Показать товары</button>
                <button type="button" className="button button-secondary" onClick={reset}>Сбросить фильтры</button>
              </div>
              <p className="muted">Выбрано: {territoryLabel(draft.region, territories)}.</p>
            </div>
          )}
        </section>
      </BottomSheet>
    </>
  );
}
