import type { AdminCardListItem } from "@agromarket/contracts";
import { useNavigate } from "@tanstack/react-router";
import type { MouseEvent } from "react";
import { formatPrice } from "../../lib/format";

interface AdminCardRowProps {
  item: AdminCardListItem;
  categoryName?: string;
  href: string;
}

/** Строка карточки в списке админа: миниатюра, название, категория+цена, бейдж «Скрыта». */
export function AdminCardRow({ item, categoryName, href }: AdminCardRowProps) {
  const navigate = useNavigate();

  function handleClick(event: MouseEvent<HTMLAnchorElement>) {
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return;
    event.preventDefault();
    void navigate({ href });
  }

  return (
    <a href={href} className="admin-card-row" data-testid="admin-card-row" data-card-id={item.id} onClick={handleClick}>
      <div className="admin-card-row-thumb">
        {item.imageUrl ? <img src={item.imageUrl} alt="" /> : <div className="admin-card-row-thumb-placeholder" />}
      </div>
      <div className="admin-card-row-body">
        <span className="admin-card-row-title">
          {item.title}
          {item.publicationStatus === "draft" && <span className="badge badge--muted">Черновик</span>}
          {item.publicationStatus === "archived" && <span className="badge badge--muted">Скрыта</span>}
          {item.needsReview && <span className="badge badge--warning">Нужно дополнить</span>}
        </span>
        <span className="admin-card-row-meta">
          {categoryName ?? "—"} · {formatPrice(item.priceType, item.priceAmount, item.priceUnit)}
        </span>
      </div>
      <span className="list-row-chevron" aria-hidden="true">
        ›
      </span>
    </a>
  );
}
