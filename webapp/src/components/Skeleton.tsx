export function Skeleton({ height = 20, width = "100%" }: { height?: number; width?: number | string }) {
  return <div className="skeleton" style={{ height, width }} />;
}

/** Список плейсхолдеров-строк — заглушка на время загрузки списка категорий/карточек. */
export function SkeletonList({ rows = 5 }: { rows?: number }) {
  return (
    <div className="skeleton-list">
      {Array.from({ length: rows }, (_, i) => (
        <Skeleton key={i} height={64} />
      ))}
    </div>
  );
}
