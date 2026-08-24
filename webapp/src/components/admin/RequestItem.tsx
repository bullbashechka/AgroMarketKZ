import {
  catalogTypeTabLabels,
  commodityGroupLabels,
  productLocationLabels,
  productOwnershipFormLabels,
  requestStatusLabels,
  type Request,
  type RequestStatus
} from "@agromarket/contracts";
import { formatDateTime, formatPrice } from "../../lib/format";

const nextAction: Record<RequestStatus, { label: string; next: RequestStatus }> = {
  new: { label: "Взять в работу", next: "in_progress" },
  in_progress: { label: "Закрыть", next: "closed" },
  closed: { label: "Вернуть в работу", next: "in_progress" }
};

interface RequestItemProps {
  request: Request;
  onChangeStatus: (status: RequestStatus) => void;
  pending?: boolean;
}

function sourceLabel(request: Request): string {
  if (request.source === "card") {
    return `Карточка: «${request.cardTitleSnapshot ?? "удалена"}»`;
  }
  if (request.source === "tab") {
    return `Вкладка: ${request.tabType ? catalogTypeTabLabels[request.tabType] : "—"}`;
  }
  return "Из профиля";
}

/** Заявка в списке админа: контакты, источник, комментарий, кнопка смены статуса. */
export function RequestItem({ request, onChangeStatus, pending }: RequestItemProps) {
  const action = nextAction[request.status];

  return (
    <div className="request-item" data-testid="admin-request-row" data-request-id={request.id}>
      <div className="request-item-header">
        <span className="request-item-name">{request.contactName}</span>
        <span className="request-item-date">{formatDateTime(request.createdAt)}</span>
      </div>

      <a href={`tel:${request.contactPhone}`} className="request-item-phone">
        {request.contactPhone}
      </a>
      {request.contactPhoneVerified && (
        <span className="phone-verified">✓ подтверждён через Telegram</span>
      )}

      <p className="request-item-source">{sourceLabel(request)}</p>

      {request.source === "card" && request.cardPriceTypeSnapshot && (
        <p className="muted">
          {formatPrice(request.cardPriceTypeSnapshot, request.cardPriceAmountSnapshot, request.cardPriceUnitSnapshot)}
        </p>
      )}

      {request.listingSubmission && (
        <div className="request-listing-submission">
          <strong>{request.listingSubmission.type === "product" ? "Предложение товара" : "Предложение услуги"}</strong>
          <span>Категория: {request.listingSubmission.categoryName}</span>
          {request.listingSubmission.type === "product" ? (
            <>
              <span>Регион: {request.listingSubmission.territory.name}</span>
              <span>Форма: {productOwnershipFormLabels[request.listingSubmission.ownershipForm]}</span>
              {request.listingSubmission.commodityGroup && <span>Группа: {commodityGroupLabels[request.listingSubmission.commodityGroup]}</span>}
              {request.listingSubmission.volumeTonnes !== null && <span>Объём: {request.listingSubmission.volumeTonnes.toLocaleString("ru-RU", { maximumFractionDigits: 3 })} т</span>}
              {request.listingSubmission.productLocation && <span>Местонахождение: {productLocationLabels[request.listingSubmission.productLocation]}{request.listingSubmission.productLocationDetail ? ` — ${request.listingSubmission.productLocationDetail}` : ""}</span>}
            </>
          ) : (
            <span>
              Регион работы: {request.listingSubmission.allKazakhstan
                ? "весь Казахстан"
                : request.listingSubmission.territories.map((territory) => territory.name).join(", ")}
            </span>
          )}
        </div>
      )}

      {request.comment && <p className="request-item-comment">«{request.comment}»</p>}

      <div className="request-item-footer">
        <span
          className={`request-status request-status--${request.status}`}
          data-testid="request-status-value"
        >
          {requestStatusLabels[request.status]}
        </span>
        <button
          type="button"
          className="button button-secondary"
          data-testid="request-status-next"
          onClick={() => onChangeStatus(action.next)}
          disabled={pending}
        >
          {pending ? "…" : action.label}
        </button>
      </div>
    </div>
  );
}
