import type { CatalogRegionFilter, Territory } from "@agromarket/contracts";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { territoriesQueryOptions } from "../lib/queries";
import { BottomSheet } from "./BottomSheet";
import { ErrorState } from "./ErrorState";
import { SkeletonList } from "./Skeleton";

interface RegionFilterProps {
  value: CatalogRegionFilter;
  onChange: (region: CatalogRegionFilter) => void;
}

function regionLabel(value: CatalogRegionFilter, territories: Territory[]): string {
  if (value === "all_regions") return "Все регионы";
  if (value === "republican_cities") return "Города республиканского значения";
  return territories.find((territory) => territory.code === value)?.name ?? "Все регионы";
}

/** Единый фильтр территории для вкладок: регионы и отдельная группа трёх городов. */
export function RegionFilter({ value, onChange }: RegionFilterProps) {
  const [open, setOpen] = useState(false);
  const territoriesQuery = useQuery(territoriesQueryOptions);
  const territories = territoriesQuery.data ?? [];
  const regions = territories.filter((territory) => territory.kind === "region");
  const cities = territories.filter((territory) => territory.kind === "republican_city");
  const label = regionLabel(value, territories);

  function select(next: CatalogRegionFilter) {
    onChange(next);
    setOpen(false);
  }

  return (
    <>
      <button
        type="button"
        className="category-filter-trigger region-filter-trigger"
        data-testid="region-filter-trigger"
        onClick={() => setOpen(true)}
        disabled={territoriesQuery.isPending}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={`Выбрать регион. Сейчас: ${label}`}
      >
        <svg className="category-filter-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
          <path d="M12 21s7-5.2 7-12a7 7 0 1 0-14 0c0 6.8 7 12 7 12Z" />
          <circle cx="12" cy="9" r="2" />
        </svg>
        <span className="category-filter-label">{label}</span>
        <svg className="category-filter-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
          <path d="m7 10 5 5 5-5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>

      <BottomSheet open={open} onClose={() => setOpen(false)}>
        <section className="category-sheet" aria-label="Выбор региона">
          <h2 className="screen-title">Регион</h2>
          {territoriesQuery.isPending && <SkeletonList rows={5} />}
          {territoriesQuery.isError && <ErrorState onRetry={territoriesQuery.refetch} />}
          {territoriesQuery.data && (
            <div className="category-sheet-options" role="group" aria-label="Регионы работы">
              <button
                type="button"
                className={`category-sheet-option${value === "all_regions" ? " category-sheet-option--selected" : ""}`}
                data-testid="region-filter-all"
                aria-pressed={value === "all_regions"}
                onClick={() => select("all_regions")}
              >
                Все регионы
              </button>
              {regions.map((territory) => (
                <button
                  key={territory.code}
                  type="button"
                  className={`category-sheet-option${value === territory.code ? " category-sheet-option--selected" : ""}`}
                  aria-pressed={value === territory.code}
                  onClick={() => select(territory.code)}
                >
                  {territory.name}
                </button>
              ))}
              <button
                type="button"
                className={`category-sheet-option${value === "republican_cities" ? " category-sheet-option--selected" : ""}`}
                aria-pressed={value === "republican_cities"}
                onClick={() => select("republican_cities")}
              >
                Города республиканского значения
              </button>
              <div className="region-filter-cities" aria-label="Города республиканского значения">
                {cities.map((territory) => <span key={territory.code}>{territory.name}</span>)}
              </div>
            </div>
          )}
        </section>
      </BottomSheet>
    </>
  );
}
