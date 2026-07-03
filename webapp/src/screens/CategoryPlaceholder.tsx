import type { CatalogType } from "@agromarket/contracts";
import { useQuery } from "@tanstack/react-query";
import { useParams } from "@tanstack/react-router";
import { Screen } from "../components/Screen";
import { categoriesQueryOptions } from "../lib/queries";
import { tabRootPath, type TabSection } from "../lib/tabHistory";

interface CategoryPlaceholderProps {
  type: CatalogType;
  section: TabSection;
}

/**
 * Второй уровень стека вкладки: подтверждает работу BackButton, памяти вкладок и
 * scroll-restoration. Имя категории читается из уже загруженного кэша списка (мгновенно).
 */
export function CategoryPlaceholder({ type, section }: CategoryPlaceholderProps) {
  const { categoryId } = useParams({ strict: false }) as { categoryId: string };
  const { data } = useQuery(categoriesQueryOptions(type));
  const category = data?.find((c) => c.id === categoryId);

  return (
    <Screen back title={category?.name ?? "Категория"} fallbackTo={tabRootPath(section)}>
      <p className="muted">Список карточек этой категории появится на Этапе 6.</p>
    </Screen>
  );
}
