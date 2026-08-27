import { productLocationLabels, productOwnershipFormLabels, type CardListItem } from "@agromarket/contracts";
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
  const productDetails = item.type === "product"
    ? [
        territory,
        item.volumeTonnes !== null ? `${item.volumeTonnes.toLocaleString("ru-RU", { maximumFractionDigits: 3 })} т` : null,
        item.ownershipForm ? productOwnershipFormLabels[item.ownershipForm] : null,
        item.productLocation ? productLocationLabels[item.productLocation] : null,
      ].filter(Boolean).join(" · ")
    : null;

  function handleClick(event: MouseEvent<HTMLAnchorElement>) {
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return;
    event.preventDefault();
    void navigate({ href });
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
        <p className="card-tile-price">{formatPrice(item.priceType, item.priceAmount, item.priceUnit)}</p>
        <p className="card-tile-title">{item.title}</p>
        {productDetails && <span className="card-tile-territory">{productDetails}</span>}
        {item.type === "service" && territory && <span className="card-tile-territory">{territory}</span>}
        {item.shortSpec && <span className="card-tile-spec">{item.shortSpec}</span>}
      </div>
    </a>
  );
}
