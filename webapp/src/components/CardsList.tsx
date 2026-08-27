import type { CatalogRegionFilter, CatalogType, CommodityGroup, PriceFilter, ProductLocation, ProductOwnershipForm, ProductSort } from "@agromarket/contracts";
import { useInfiniteQuery } from "@tanstack/react-query";
import { useEffect, useRef, type ReactNode } from "react";
import { cardsInfiniteQueryOptions } from "../lib/queries";
import { CardTile } from "./CardTile";
import { ErrorState } from "./ErrorState";
import { SkeletonList } from "./Skeleton";

interface CardsListProps {
  type: CatalogType;
  categoryId?: string;
  search?: string;
  price?: PriceFilter;
  region: CatalogRegionFilter;
  sort?: ProductSort;
  commodityGroups?: CommodityGroup[];
  ownershipForms?: ProductOwnershipForm[];
  productLocation?: ProductLocation | "all";
  /** Показывается вместо сетки, когда выдача пуста (текст различается для каталога/поиска). */
  emptyState: ReactNode;
}

/** Постраничный список карточек: автоподгрузка по скроллу + кнопка-фолбэк «Показать ещё». */
export function CardsList({ type, categoryId, search, price, region, sort, commodityGroups, ownershipForms, productLocation, emptyState }: CardsListProps) {
  const { data, isPending, isError, refetch, fetchNextPage, hasNextPage, isFetchingNextPage, isPlaceholderData } =
    useInfiniteQuery(cardsInfiniteQueryOptions({ type, categoryId, search, price, region, sort, commodityGroups, ownershipForms, productLocation }));

  const sentinelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = sentinelRef.current;
    if (!el || !hasNextPage) return;
    const observer = new IntersectionObserver((entries) => {
      if (entries[0]?.isIntersecting) void fetchNextPage();
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [hasNextPage, fetchNextPage]);

  if (isPending) return <SkeletonList />;
  if (isError) return <ErrorState onRetry={refetch} />;

  const items = data.pages.flatMap((page) => page.items);
  if (items.length === 0) return <>{emptyState}</>;

  return (
    <div className={isPlaceholderData ? "cards-list cards-list--updating" : "cards-list"}>
      <div className="grid-cards">
        {items.map((item) => (
          <CardTile key={item.id} item={item} />
        ))}
      </div>
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
    </div>
  );
}
