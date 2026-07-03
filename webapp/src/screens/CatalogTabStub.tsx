import type { CatalogType } from "@agromarket/contracts";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import type { MouseEvent } from "react";
import { ErrorState } from "../components/ErrorState";
import { SkeletonList } from "../components/Skeleton";
import { categoriesQueryOptions } from "../lib/queries";
import { tabRootPath, type TabSection } from "../lib/tabHistory";

interface CatalogTabStubProps {
  type: CatalogType;
  section: TabSection;
  title: string;
}

/**
 * Заглушка вкладки каталога: реальный список категорий с backend (proof-of-life data-слоя),
 * список карточек — Этап 6.
 */
export function CatalogTabStub({ type, section, title }: CatalogTabStubProps) {
  const { data, isPending, isError, refetch } = useQuery(categoriesQueryOptions(type));
  const navigate = useNavigate();

  // Категория — динамический путь вне статичного дерева маршрутов, поэтому обычный <a>
  // + navigate({href}) вместо типизированного <Link to=...> (сохраняем открытие в новой вкладке/Ctrl+клик).
  function handleCategoryClick(event: MouseEvent<HTMLAnchorElement>, href: string) {
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return;
    event.preventDefault();
    navigate({ href });
  }

  return (
    <div className="screen">
      <div className="screen-header">
        <h2 className="screen-title">{title}</h2>
      </div>

      {isPending && <SkeletonList />}
      {isError && <ErrorState onRetry={refetch} />}
      {data && data.length === 0 && <p className="muted">Категории пока не добавлены.</p>}
      {data && data.length > 0 && (
        <div className="grid-cards">
          {data.map((category) => {
            const href = `${tabRootPath(section)}/${category.id}`;
            return (
              <a
                key={category.id}
                href={href}
                className="category-chip"
                onClick={(e) => handleCategoryClick(e, href)}
              >
                {category.name}
              </a>
            );
          })}
        </div>
      )}
    </div>
  );
}
