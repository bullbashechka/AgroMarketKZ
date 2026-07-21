type SkeletonSize = "line" | "title" | "card";
type SkeletonWidth = "full" | "sixty" | "eighty" | "ninety";

export function Skeleton({ size = "line", width = "full" }: { size?: SkeletonSize; width?: SkeletonWidth }) {
  return <div className={`skeleton skeleton--${size} skeleton--${width}`} />;
}

/** Список плейсхолдеров-строк — заглушка на время загрузки списка категорий/карточек. */
export function SkeletonList({ rows = 5 }: { rows?: number }) {
  return (
    <div className="skeleton-list">
      {Array.from({ length: rows }, (_, i) => (
        <Skeleton key={i} size="card" />
      ))}
    </div>
  );
}
