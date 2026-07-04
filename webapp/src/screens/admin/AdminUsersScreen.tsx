import { useInfiniteQuery } from "@tanstack/react-query";
import { useEffect, useRef } from "react";
import { ErrorState } from "../../components/ErrorState";
import { Screen } from "../../components/Screen";
import { SkeletonList } from "../../components/Skeleton";
import { formatDateTime } from "../../lib/format";
import { adminUsersInfiniteQueryOptions } from "../../lib/queries";

/** Read-only список зарегистрированных пользователей (админ) с постраничной подгрузкой. */
export function AdminUsersScreen() {
  const { data, isPending, isError, refetch, fetchNextPage, hasNextPage, isFetchingNextPage } = useInfiniteQuery(
    adminUsersInfiniteQueryOptions
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
    <Screen back title="Пользователи" fallbackTo="/general">
      {isPending && <SkeletonList />}
      {isError && <ErrorState onRetry={refetch} />}
      {data && (
        <>
          {data.pages[0]?.items.length === 0 ? (
            <div className="empty-state">
              <p>Пока никто не зарегистрировался.</p>
            </div>
          ) : (
            <div className="list-rows">
              {data.pages.flatMap((page) => page.items).map((user) => {
                const telegramName = [user.telegramFirstName, user.telegramLastName].filter(Boolean).join(" ");
                const name = user.contactName ?? (telegramName || "Без имени");
                return (
                  <div key={user.id} className="user-row">
                    <div className="user-row-main">
                      <span className="user-row-name">{name}</span>
                      {user.telegramUsername && <span className="user-row-username">@{user.telegramUsername}</span>}
                    </div>
                    <div className="user-row-meta">
                      {user.contactPhone && <span>{user.contactPhone}</span>}
                      {user.registeredAt && <span>Регистрация: {formatDateTime(user.registeredAt)}</span>}
                    </div>
                  </div>
                );
              })}
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
