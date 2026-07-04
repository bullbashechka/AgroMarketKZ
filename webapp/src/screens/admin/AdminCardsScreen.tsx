import type { CatalogType } from "@agromarket/contracts";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { useNavigate, useSearch } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { AdminCardRow } from "../../components/admin/AdminCardRow";
import { Segmented } from "../../components/admin/Segmented";
import { ErrorState } from "../../components/ErrorState";
import { Screen } from "../../components/Screen";
import { SearchBar } from "../../components/SearchBar";
import { SkeletonList } from "../../components/Skeleton";
import { adminCardsInfiniteQueryOptions, adminCategoriesQueryOptions } from "../../lib/queries";
import { buildAdminCardsQuery, type AdminCardsSearch } from "../../lib/searchParams";
import { useDebouncedValue } from "../../lib/useDebouncedValue";

const typeOptions: { value: CatalogType; label: string }[] = [
  { value: "service", label: "Услуги" },
  { value: "product", label: "Товары" }
];

/** Единый список карточек админа: тип, поиск, фильтр категории, скрытые с бейджем. */
export function AdminCardsScreen() {
  const search = useSearch({ strict: false }) as AdminCardsSearch;
  const navigate = useNavigate();
  const type: CatalogType = search.type ?? "service";
  const [inputValue, setInputValue] = useState(search.q ?? "");
  const debouncedQuery = useDebouncedValue(inputValue, 500);

  const categoriesQuery = useQuery(adminCategoriesQueryOptions(type));
  const categoryNameById = new Map((categoriesQuery.data ?? []).map((c) => [c.id, c.name]));

  useEffect(() => {
    const nextQuery = debouncedQuery.trim();
    if (nextQuery === (search.q ?? "")) return;
    navigate({
      href: `/admin/cards${buildAdminCardsQuery({ type, categoryId: search.categoryId, q: nextQuery || undefined })}`,
      replace: true
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedQuery]);

  function handleTypeChange(nextType: CatalogType) {
    navigate({ href: `/admin/cards${buildAdminCardsQuery({ type: nextType, q: search.q })}`, replace: true });
  }

  function handleCategoryChange(categoryId: string | undefined) {
    navigate({ href: `/admin/cards${buildAdminCardsQuery({ type, categoryId, q: search.q })}`, replace: true });
  }

  const { data, isPending, isError, refetch, fetchNextPage, hasNextPage, isFetchingNextPage } = useInfiniteQuery(
    adminCardsInfiniteQueryOptions({ type, categoryId: search.categoryId, search: search.q })
  );

  const sentinelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = sentinelRef.current;
    if (!el || !hasNextPage) return;
    const observer = new IntersectionObserver((entries) => {
      if (entries[0]?.isIntersecting) fetchNextPage();
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [hasNextPage, fetchNextPage]);

  return (
    <Screen back title="Карточки" fallbackTo="/general">
      <Segmented options={typeOptions} value={type} onChange={handleTypeChange} ariaLabel="Тип карточек" />

      <SearchBar value={inputValue} onChange={setInputValue} placeholder="Поиск по названию" />

      <select
        className="input select-filter"
        value={search.categoryId ?? ""}
        onChange={(e) => handleCategoryChange(e.target.value || undefined)}
      >
        <option value="">Все категории</option>
        {(categoriesQuery.data ?? []).map((category) => (
          <option key={category.id} value={category.id}>
            {category.name}
          </option>
        ))}
      </select>

      <button
        type="button"
        className="button button-primary tab-cta"
        onClick={() => navigate({ href: `/admin/cards/new?type=${type}` })}
      >
        + Добавить карточку
      </button>

      {isPending && <SkeletonList />}
      {isError && <ErrorState onRetry={refetch} />}
      {data && (
        <>
          {data.pages[0]?.items.length === 0 ? (
            <div className="empty-state">
              <p>Карточек нет. Добавьте первую.</p>
            </div>
          ) : (
            <div className="list-rows">
              {data.pages.flatMap((page) => page.items).map((item) => (
                <AdminCardRow
                  key={item.id}
                  item={item}
                  categoryName={categoryNameById.get(item.categoryId)}
                  href={`/admin/cards/${item.id}`}
                />
              ))}
            </div>
          )}
          {hasNextPage && (
            <div ref={sentinelRef} className="load-more">
              <button
                type="button"
                className="button button-secondary"
                onClick={() => fetchNextPage()}
                disabled={isFetchingNextPage}
              >
                {isFetchingNextPage ? "Загружаем…" : "Показать ещё"}
              </button>
            </div>
          )}
        </>
      )}
    </Screen>
  );
}
