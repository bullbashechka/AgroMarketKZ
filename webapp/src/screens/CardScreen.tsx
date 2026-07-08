import type { PlatformSettings } from "@agromarket/contracts";
import { useQuery } from "@tanstack/react-query";
import { useNavigate, useParams } from "@tanstack/react-router";
import { useState } from "react";
import { BottomSheet } from "../components/BottomSheet";
import { FavoriteButton } from "../components/FavoriteButton";
import { Gallery } from "../components/Gallery";
import { RequestSheet } from "../components/RequestSheet";
import { Screen } from "../components/Screen";
import { SkeletonList } from "../components/Skeleton";
import { ApiError } from "../lib/api";
import { formatPrice, telegramLink, whatsappLink } from "../lib/format";
import { cardDetailQueryOptions, settingsQueryOptions } from "../lib/queries";
import { openExternalLink, openTelegramDeepLink } from "../lib/telegram";
import { tabRootPath, type TabSection } from "../lib/tabHistory";

export function CardScreen({ section }: { section: TabSection }) {
  const { cardId } = useParams({ strict: false }) as { cardId: string };
  const navigate = useNavigate();
  const [responseOpen, setResponseOpen] = useState(false);
  const [requestOpen, setRequestOpen] = useState(false);

  const cardQuery = useQuery(cardDetailQueryOptions(cardId));

  const notFound = cardQuery.error instanceof ApiError && cardQuery.error.status === 404;
  const archived = cardQuery.data?.archivedAt != null;

  if (cardQuery.isPending) {
    return (
      <Screen back fallbackTo={tabRootPath(section)}>
        <SkeletonList />
      </Screen>
    );
  }

  if (notFound || archived || !cardQuery.data) {
    return (
      <Screen back fallbackTo={tabRootPath(section)}>
        <div className="empty-state">
          <p>Это объявление больше недоступно — его сняли с публикации.</p>
          <button
            type="button"
            className="button button-secondary"
            onClick={() => navigate({ href: tabRootPath(section) })}
          >
            В каталог
          </button>
          <button type="button" className="button button-primary" onClick={() => setRequestOpen(true)}>
            Оставить заявку
          </button>
        </div>
        <RequestSheet
          open={requestOpen}
          onClose={() => setRequestOpen(false)}
          source={{ source: "tab", tabType: section === "products" ? "product" : "service" }}
        />
      </Screen>
    );
  }

  const card = cardQuery.data;

  return (
    <Screen back fallbackTo={tabRootPath(section)}>
      <Gallery images={card.images} title={card.title} />

      <div className="card-detail-body">
        <h1 className="card-detail-title">{card.title}</h1>
        <p className="card-detail-price">{formatPrice(card.priceType, card.priceAmount)}</p>

        {card.description && <p className="description">{card.description}</p>}

        {card.specs.length > 0 && (
          <dl className="specs-list">
            {card.specs.map((spec) => (
              <div key={spec.id}>
                <dt>{spec.key}</dt>
                <dd>{spec.value}</dd>
              </div>
            ))}
          </dl>
        )}
      </div>

      <div className="card-actions">
        <button type="button" className="button button-primary" onClick={() => setResponseOpen(true)}>
          Откликнуться
        </button>
        <FavoriteButton
          item={{
            id: card.id,
            type: card.type,
            categoryId: card.categoryId,
            title: card.title,
            priceType: card.priceType,
            priceAmount: card.priceAmount,
            imageUrl: card.images[0]?.url ?? null,
            shortSpec: card.specs[0] ? `${card.specs[0].key}: ${card.specs[0].value}` : null
          }}
        />
      </div>

      <BottomSheet open={responseOpen} onClose={() => setResponseOpen(false)}>
        <ResponseOptions
          onRequestClick={() => {
            setResponseOpen(false);
            setRequestOpen(true);
          }}
        />
      </BottomSheet>

      <RequestSheet
        open={requestOpen}
        onClose={() => setRequestOpen(false)}
        source={{ source: "card", cardId: card.id }}
      />
    </Screen>
  );
}

function ResponseOptions({ onRequestClick }: { onRequestClick: () => void }) {
  const settingsQuery = useQuery(settingsQueryOptions);
  const settings: PlatformSettings | undefined = settingsQuery.data;

  return (
    <div className="sheet-actions">
      <h2 className="screen-title">Связаться</h2>

      {settingsQuery.isPending && <SkeletonList rows={2} />}

      {settings?.contactPhone && (
        <a className="sheet-action" href={`tel:${settings.contactPhone}`}>
          Позвонить
        </a>
      )}
      {settings?.whatsappPhone && (
        <button
          type="button"
          className="sheet-action"
          onClick={() => openExternalLink(whatsappLink(settings.whatsappPhone!))}
        >
          WhatsApp
        </button>
      )}
      {settings?.telegramContact && (
        <button
          type="button"
          className="sheet-action"
          onClick={() => openTelegramDeepLink(telegramLink(settings.telegramContact!))}
        >
          Telegram
        </button>
      )}

      <button type="button" className="sheet-action sheet-action--primary" onClick={onRequestClick}>
        Оставить заявку
      </button>
    </div>
  );
}
