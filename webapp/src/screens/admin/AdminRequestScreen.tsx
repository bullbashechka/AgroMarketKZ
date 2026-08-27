import type { Request, RequestStatus } from "@agromarket/contracts";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useParams } from "@tanstack/react-router";
import { RequestItem } from "../../components/admin/RequestItem";
import { ErrorState } from "../../components/ErrorState";
import { Screen } from "../../components/Screen";
import { SkeletonList } from "../../components/Skeleton";
import { ApiError, apiPatch } from "../../lib/api";
import { adminRequestQueryOptions } from "../../lib/queries";

/** Деталка одной заявки — открывается по deep-link из Telegram-уведомления. */
export function AdminRequestScreen() {
  const { requestId } = useParams({ strict: false }) as { requestId: string };
  const qc = useQueryClient();

  const { data, isPending, isError, error, refetch } = useQuery(adminRequestQueryOptions(requestId));

  const mutation = useMutation({
    mutationFn: (nextStatus: RequestStatus) =>
      apiPatch<Request>(`/admin/requests/${requestId}/status`, { status: nextStatus }),
    onSuccess: (request) => {
      qc.setQueryData(adminRequestQueryOptions(requestId).queryKey, request);
      void qc.invalidateQueries({ queryKey: ["admin-requests"] });
      void qc.invalidateQueries({ queryKey: ["admin-requests-badge"] });
    }
  });

  const notFound = isError && error instanceof ApiError && error.status === 404;

  return (
    <Screen back title="Заявка" fallbackTo="/admin/requests">
      {isPending && <SkeletonList />}
      {notFound && (
        <div className="empty-state">
          <p>Заявка не найдена.</p>
        </div>
      )}
      {isError && !notFound && <ErrorState onRetry={refetch} />}
      {data && (
        <div className="list-rows">
          <RequestItem
            request={data}
            onChangeStatus={(nextStatus) => mutation.mutate(nextStatus)}
            pending={mutation.isPending}
          />
        </div>
      )}
    </Screen>
  );
}
