import type { CardDetail } from "@agromarket/contracts";
import { formatPrice } from "../lib/format";
import { Gallery } from "./Gallery";

/** Единое визуальное содержимое публичной карточки и админского предпросмотра. */
export function CardDetailsView({ card }: { card: CardDetail }) {
  return (
    <>
      <Gallery images={card.images} title={card.title} />
      <div className="card-detail-body">
        <h1 className="card-detail-title">{card.title}</h1>
        <p className="card-detail-price">{formatPrice(card.priceType, card.priceAmount, card.priceUnit)}</p>
        {card.priceReason && <p className="price-reason">{card.priceReason}</p>}
        {card.description && <p className="description">{card.description}</p>}
        {(card.location || card.availability) && (
          <p className="muted">{[card.location, card.availability].filter(Boolean).join(" · ")}</p>
        )}
        {card.specs.length > 0 && (
          <dl className="specs-list">
            {card.specs.map((spec) => <div key={spec.id}><dt>{spec.key}</dt><dd>{spec.value}</dd></div>)}
          </dl>
        )}
      </div>
    </>
  );
}
