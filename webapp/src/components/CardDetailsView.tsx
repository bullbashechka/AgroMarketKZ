import { commodityGroupLabels, productLocationLabels, productOwnershipFormLabels, type CardDetail } from "@agromarket/contracts";
import { formatPrice } from "../lib/format";
import { Gallery } from "./Gallery";

/** Единое визуальное содержимое публичной карточки и админского предпросмотра. */
export function CardDetailsView({ card }: { card: CardDetail }) {
  const hasStructuredLocation = card.type === "product"
    ? card.territory !== null
    : card.serviceAllKazakhstan || card.serviceTerritories.length > 0;
  const legacyLocation = hasStructuredLocation ? null : card.location;

  return (
    <>
      <Gallery images={card.images} title={card.title} />
      <div className="card-detail-body">
        <h1 className="card-detail-title">{card.title}</h1>
        <p className="card-detail-price">{formatPrice(card.priceType, card.priceAmount, card.priceUnit)}</p>
        {card.priceReason && <p className="price-reason">{card.priceReason}</p>}
        {card.description && <p className="description">{card.description}</p>}
        {card.type === "product" && (
          <dl className="card-facts">
            {card.territory && <div><dt>Регион</dt><dd>{card.territory.name}</dd></div>}
            {card.commodityGroup && <div><dt>Группа продукции</dt><dd>{commodityGroupLabels[card.commodityGroup]}</dd></div>}
            {card.volumeTonnes !== null && <div><dt>Объём</dt><dd>{card.volumeTonnes.toLocaleString("ru-RU", { maximumFractionDigits: 3 })} т</dd></div>}
            {card.ownershipForm && <div><dt>Форма собственности</dt><dd>{productOwnershipFormLabels[card.ownershipForm]}</dd></div>}
            {card.productLocation && <div><dt>Местонахождение</dt><dd>{productLocationLabels[card.productLocation]}{card.productLocationDetail ? ` — ${card.productLocationDetail}` : ""}</dd></div>}
          </dl>
        )}
        {card.type === "service" && (
          <dl className="card-facts">
            <div><dt>Регион работы</dt><dd>{card.serviceAllKazakhstan ? "Весь Казахстан" : card.serviceTerritories.map((territory) => territory.name).join(", ") || "Не указан"}</dd></div>
          </dl>
        )}
        {card.type === "service" && (legacyLocation || card.availability) && <p className="muted">{[legacyLocation, card.availability].filter(Boolean).join(" · ")}</p>}
        {card.specs.length > 0 && (
          <dl className="specs-list">
            {card.specs.map((spec) => <div key={spec.id}><dt>{spec.key}</dt><dd>{spec.value}</dd></div>)}
          </dl>
        )}
      </div>
    </>
  );
}
