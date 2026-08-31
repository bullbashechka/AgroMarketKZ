import { useInfiniteQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { CardTile } from "../components/CardTile";
import { ErrorState } from "../components/ErrorState";
import { Screen } from "../components/Screen";
import { SkeletonList } from "../components/Skeleton";
import { useAuth } from "../lib/auth";
import { favoritesInfiniteQueryOptions } from "../lib/queries";
import { useRegistrationIntent } from "../lib/registrationIntent";

export function FavoritesScreen() {
  const { profile } = useAuth();
  const { requireRegistration } = useRegistrationIntent();
  const { data, isPending, isError, refetch, fetchNextPage, hasNextPage, isFetchingNextPage } = useInfiniteQuery({
    ...favoritesInfiniteQueryOptions,
    enabled: profile?.isRegistered === true,
  });
  const navigate = useNavigate();
  const items = data ? Array.from(new Map(data.pages.flatMap((page) => page.items).map((item) => [item.id, item])).values()) : [];

  return (
    <Screen back title="Избранное" fallbackTo="/general">
      {!profile?.isRegistered && (
        <div className="empty-state">
          <p>Сохраните контакты, чтобы пользоваться избранным.</p>
          <button
            type="button"
            className="button button-primary"
            onClick={() => requireRegistration(() => {}, "Сохраните контакты, чтобы пользоваться избранным.")}
          >
            Указать контакты
          </button>
        </div>
      )}
      {profile?.isRegistered && isPending && <SkeletonList />}
      {isError && <ErrorState onRetry={refetch} />}
      {data && items.length === 0 && (
        <div className="empty-state">
          <p>В избранном пока пусто.</p>
          <button type="button" className="button button-primary" onClick={() => navigate({ href: "/products" })}>
            В каталог
          </button>
        </div>
      )}
      {data && items.length > 0 && (
        <>
          <div className="grid-cards">
          {items.map((item) => (
            <CardTile key={item.id} item={item} knownIsFavorite />
          ))}
          </div>
          {hasNextPage && (
            <div className="load-more">
              <button type="button" className="button button-secondary" onClick={() => fetchNextPage()} disabled={isFetchingNextPage}>
                {isFetchingNextPage ? "Загружаем…" : "Показать ещё"}
              </button>
            </div>
          )}
        </>
      )}
    </Screen>
  );
}
