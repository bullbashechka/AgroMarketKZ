import { requestStatusLabels, type Request, type RequestStatus } from "@agromarket/contracts";
import { useInfiniteQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate, useSearch } from "@tanstack/react-router";
import { useEffect, useRef } from "react";
import { RequestItem } from "../../components/admin/RequestItem";
import { Segmented } from "../../components/admin/Segmented";
import { ErrorState } from "../../components/ErrorState";
import { Screen } from "../../components/Screen";
import { SkeletonList } from "../../components/Skeleton";
import { apiPatch } from "../../lib/api";
import { adminRequestsInfiniteQueryOptions } from "../../lib/queries";
import type { AdminRequestsSearch } from "../../lib/searchParams";

const statusOptions: { value: RequestStatus; label: string }[] = [
  { value: "new", label: requestStatusLabels.new },
  { value: "in_progress", label: requestStatusLabels.in_progress },
  { value: "closed", label: requestStatusLabels.closed }
];

export function AdminRequestsScreen() {
  const search = useSearch({ strict: false }) as AdminRequestsSearch;
  const navigate = useNavigate();
  const qc = useQueryClient();
  const status: RequestStatus = search.status ?? "new";

  const { data, isPending, isError, refetch, fetchNextPage, hasNextPage, isFetchingNextPage } = useInfiniteQuery(
    adminRequestsInfiniteQueryOptions(status)
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

  const mutation = useMutation({
    mutationFn: ({ id, nextStatus }: { id: string; nextStatus: RequestStatus }) =>
      apiPatch<Request>(`/admin/requests/${id}/status`, { status: nextStatus }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin-requests"] });
      qc.invalidateQueries({ queryKey: ["admin-requests-badge"] });
    }
  });

  function handleStatusChange(status: RequestStatus) {
    navigate({ href: `/admin/requests?status=${status}`, replace: true });
  }

  return (
    <Screen back title="Заявки" fallbackTo="/general">
      <Segmented options={statusOptions} value={status} onChange={handleStatusChange} ariaLabel="Статус заявок" />

      {isPending && <SkeletonList />}
      {isError && <ErrorState onRetry={refetch} />}
      {data && (
        <>
          {data.pages[0]?.items.length === 0 ? (
            <div className="empty-state">
              <p>Заявок с таким статусом нет.</p>
            </div>
          ) : (
            <div className="list-rows">
              {data.pages.flatMap((page) => page.items).map((request) => (
                <RequestItem
                  key={request.id}
                  request={request}
                  onChangeStatus={(nextStatus) => mutation.mutate({ id: request.id, nextStatus })}
                  pending={mutation.isPending && mutation.variables?.id === request.id}
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
