import type { PlatformSettings, PriceType } from "@agromarket/contracts";
import { useQuery } from "@tanstack/react-query";
import { useNavigate, useParams } from "@tanstack/react-router";
import { useState } from "react";
import { BottomSheet } from "../components/BottomSheet";
import { CardDetailsView } from "../components/CardDetailsView";
import { FavoriteButton } from "../components/FavoriteButton";
import { RequestSheet } from "../components/RequestSheet";
import { Screen } from "../components/Screen";
import { SkeletonList } from "../components/Skeleton";
import { ApiError } from "../lib/api";
import { useAuth } from "../lib/auth";
import { formatPrice, telegramLink, whatsappLink } from "../lib/format";
import {
  cardDetailQueryOptions,
  contactCapabilitiesQueryOptions,
  settingsQueryOptions,
} from "../lib/queries";
import { useRegistrationIntent } from "../lib/registrationIntent";
import { openExternalLink, openTelegramDeepLink } from "../lib/telegram";
import { tabRootPath, type TabSection } from "../lib/tabHistory";

type DirectChannel = "phone" | "whatsapp" | "telegram";

const cardCta: Record<PriceType, string> = {
  fixed: "Связаться с менеджером",
  from: "Уточнить стоимость",
  on_request: "Узнать цену",
};

const requestCta: Record<PriceType, string> = {
  fixed: "Заказать звонок",
  from: "Уточнить стоимость",
  on_request: "Запросить цену",
};

export function CardScreen({ section }: { section: TabSection }) {
  const { cardId } = useParams({ strict: false }) as { cardId: string };
  const navigate = useNavigate();
  const { profile } = useAuth();
  const { requireRegistration } = useRegistrationIntent();
  const [responseOpen, setResponseOpen] = useState(false);
  const [requestOpen, setRequestOpen] = useState(false);
  const [continuation, setContinuation] = useState<DirectChannel | null>(null);
  const cardQuery = useQuery(cardDetailQueryOptions(cardId));
  const settingsQuery = useQuery({
    ...settingsQueryOptions,
    enabled: profile?.isRegistered === true && continuation !== null,
  });

  const notFound = cardQuery.error instanceof ApiError && cardQuery.error.status === 404;
  const archived = cardQuery.data?.archivedAt != null;
  const tabType = section === "products" ? "product" : "service";

  function beginDirect(channel: DirectChannel) {
    if (profile?.isRegistered) {
      openDirect(channel, settingsQuery.data);
      return;
    }
    setResponseOpen(false);
    requireRegistration(
      () => setContinuation(channel),
      "Сохраним контакты, чтобы вам не пришлось вводить их при следующей заявке.",
    );
  }

  if (cardQuery.isPending) {
    return <Screen back fallbackTo={tabRootPath(section)}><SkeletonList /></Screen>;
  }

  if (notFound || archived || !cardQuery.data) {
    return (
      <Screen back fallbackTo={tabRootPath(section)}>
        <div className="empty-state">
          <p>Это объявление больше недоступно — его сняли с публикации.</p>
          <button type="button" className="button button-secondary" onClick={() => navigate({ href: tabRootPath(section) })}>
            В каталог
          </button>
          <button type="button" className="button button-primary" data-testid="card-request-cta" onClick={() => setRequestOpen(true)}>
            Оставить общую заявку
          </button>
        </div>
        <RequestSheet open={requestOpen} onClose={() => setRequestOpen(false)} source={{ source: "tab", tabType }} />
      </Screen>
    );
  }

  const card = cardQuery.data;
  return (
    <Screen back fallbackTo={tabRootPath(section)}>
      <CardDetailsView card={card} />

      <div className="card-actions">
        <button type="button" className="button button-primary" data-testid="card-respond-button" onClick={() => setResponseOpen(true)}>
          {cardCta[card.priceType]}
        </button>
        <FavoriteButton item={{
          id: card.id,
          type: card.type,
          categoryId: card.categoryId,
          title: card.title,
          priceType: card.priceType,
          priceAmount: card.priceAmount,
          priceUnit: card.priceUnit,
          imageUrl: card.images[0]?.url ?? null,
          shortSpec: card.location && card.availability ? `${card.location} · ${card.availability}` : null,
        }} />
      </div>

      <BottomSheet open={responseOpen} onClose={() => setResponseOpen(false)}>
        <ResponseOptions
          priceType={card.priceType}
          onDirect={beginDirect}
          onRequestClick={() => { setResponseOpen(false); setRequestOpen(true); }}
        />
      </BottomSheet>

      <RequestSheet
        open={requestOpen}
        onClose={() => setRequestOpen(false)}
        source={{
          source: "card",
          cardId: card.id,
          cardTitle: card.title,
          tabType: card.type,
          priceType: card.priceType,
        }}
      />

      <BottomSheet open={continuation !== null} onClose={() => setContinuation(null)}>
        <div className="form">
          <h2 className="screen-title">Контакты сохранены</h2>
          <p className="description">Продолжите выбранное действие, когда будете готовы.</p>
          {settingsQuery.isPending && <SkeletonList rows={1} />}
          {settingsQuery.isError && <p className="field-error">Прямые контакты временно недоступны — оставьте заявку.</p>}
          {continuation && settingsQuery.data && (
            <button
              type="button"
              className="button button-primary"
              onClick={() => { openDirect(continuation, settingsQuery.data); setContinuation(null); }}
            >
              {continuation === "phone" ? "Позвонить менеджеру" : `Продолжить в ${continuation === "whatsapp" ? "WhatsApp" : "Telegram"}`}
            </button>
          )}
          <button type="button" className="button button-secondary" onClick={() => { setContinuation(null); setRequestOpen(true); }}>
            Оставить заявку
          </button>
        </div>
      </BottomSheet>
    </Screen>
  );
}

function openDirect(channel: DirectChannel, settings: PlatformSettings | undefined) {
  if (channel === "phone" && settings?.contactPhone) openExternalLink(`tel:${settings.contactPhone}`);
  if (channel === "whatsapp" && settings?.whatsappPhone) openExternalLink(whatsappLink(settings.whatsappPhone));
  if (channel === "telegram" && settings?.telegramContact) {
    const link = telegramLink(settings.telegramContact);
    if (link) openTelegramDeepLink(link);
  }
}

function ResponseOptions({
  priceType,
  onDirect,
  onRequestClick,
}: {
  priceType: PriceType;
  onDirect: (channel: DirectChannel) => void;
  onRequestClick: () => void;
}) {
  const { profile } = useAuth();
  const capabilities = useQuery(contactCapabilitiesQueryOptions);
  const settingsQuery = useQuery({ ...settingsQueryOptions, enabled: profile?.isRegistered === true });
  const available = profile?.isRegistered
    ? {
        phone: Boolean(settingsQuery.data?.contactPhone),
        whatsapp: Boolean(settingsQuery.data?.whatsappPhone),
        telegram: Boolean(settingsQuery.data?.telegramContact && telegramLink(settingsQuery.data.telegramContact)),
      }
    : capabilities.data;
  const pending = profile?.isRegistered ? settingsQuery.isPending : capabilities.isPending;
  const error = profile?.isRegistered ? settingsQuery.isError : capabilities.isError;

  function direct(channel: DirectChannel) {
    if (profile?.isRegistered) {
      openDirect(channel, settingsQuery.data);
      return;
    }
    onDirect(channel);
  }

  return (
    <div className="sheet-actions">
      <h2 className="screen-title">Выберите способ связи</h2>
      <button type="button" className="sheet-action sheet-action--primary" data-testid="response-request" onClick={onRequestClick}>
        {requestCta[priceType]}
      </button>
      <p className="muted">Менеджер свяжется с вами в рабочее время.</p>
      {pending && (
        <div role="status" aria-live="polite">
          <span className="visually-hidden">Загружаем доступные способы связи.</span>
          <SkeletonList rows={2} />
        </div>
      )}
      {error && <p className="field-error" role="alert">Прямые контакты временно недоступны — оставьте заявку.</p>}
      {(available?.phone || available?.whatsapp || available?.telegram) && <p className="eyebrow">Или свяжитесь самостоятельно</p>}
      {available?.phone && <button type="button" className="sheet-action" data-testid="response-phone" onClick={() => direct("phone")}>Позвонить менеджеру</button>}
      {available?.whatsapp && <button type="button" className="sheet-action" data-testid="response-whatsapp" onClick={() => direct("whatsapp")}>Написать в WhatsApp</button>}
      {available?.telegram && <button type="button" className="sheet-action" data-testid="response-telegram" onClick={() => direct("telegram")}>Написать в Telegram</button>}
    </div>
  );
}
