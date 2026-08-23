import type { CardListItem } from "@agromarket/contracts";
import { useNavigate } from "@tanstack/react-router";
import type { MouseEvent } from "react";
import { cardHref, formatPrice } from "../lib/format";
import { FavoriteButton } from "./FavoriteButton";

function territorySummary(item: CardListItem): string | null {
  if (item.type === "product") return item.territory?.name ?? null;
  if (item.serviceAllKazakhstan) return "Весь Казахстан";
  if (item.serviceTerritories.length === 0) return null;
  if (item.serviceTerritories.length <= 2) return item.serviceTerritories.map((territory) => territory.name).join(", ");
  return `Работаем в ${item.serviceTerritories.length} регионах`;
}

/** Карточка списка в стиле маркетплейса: фото, название, цена, краткая характеристика. */
export function CardTile({ item }: { item: CardListItem }) {
  const navigate = useNavigate();
  const href = cardHref(item);
  const territory = territorySummary(item);

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
        <p className="card-tile-price">{formatPrice(item.priceType, item.priceAmount)}</p>
        <p className="card-tile-title">{item.title}</p>
        {territory && <span className="card-tile-territory">{territory}</span>}
        {item.shortSpec && <span className="card-tile-spec">{item.shortSpec}</span>}
      </div>
    </a>
  );
}
