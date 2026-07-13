import type { CardListItem } from "@agromarket/contracts";
import { useNavigate } from "@tanstack/react-router";
import type { MouseEvent } from "react";
import { cardHref, formatPrice } from "../lib/format";
import { FavoriteButton } from "./FavoriteButton";

/** Карточка списка в стиле маркетплейса: фото, название, цена, краткая характеристика. */
export function CardTile({ item }: { item: CardListItem }) {
  const navigate = useNavigate();
  const href = cardHref(item);

  function handleClick(event: MouseEvent<HTMLAnchorElement>) {
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return;
    event.preventDefault();
    navigate({ href });
  }

  return (
    <a href={href} className="card-tile" data-testid="card-tile" data-card-id={item.id} onClick={handleClick}>
      <div className="card-tile-img">
        {item.imageUrl ? (
          <img src={item.imageUrl} alt={item.title} loading="lazy" />
        ) : (
          <span className="card-tile-img-placeholder" aria-hidden="true" />
        )}
        <FavoriteButton item={item} />
      </div>
      <div className="card-tile-body">
        <p className="card-tile-title">{item.title}</p>
        <p className="card-tile-price">{formatPrice(item.priceType, item.priceAmount, item.priceUnit)}</p>
        {item.shortSpec && <p className="card-tile-spec">{item.shortSpec}</p>}
      </div>
    </a>
  );
}
