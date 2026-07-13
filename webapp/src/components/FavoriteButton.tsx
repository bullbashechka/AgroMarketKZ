import type { CardListItem } from "@agromarket/contracts";
import type { MouseEvent } from "react";
import { useIsFavorite, useToggleFavorite } from "../lib/favorites";
import { useRegistrationIntent } from "../lib/registrationIntent";

/** Сердечко избранного — переиспользуется в списке карточек и внутри самой карточки. */
export function FavoriteButton({ item }: { item: CardListItem }) {
  const isFavorite = useIsFavorite(item.id);
  const toggle = useToggleFavorite();
  const { requireRegistration } = useRegistrationIntent();

  function handleClick(event: MouseEvent<HTMLButtonElement>) {
    // Кнопка часто лежит поверх кликабельной карточки — не даём тапу открыть карточку.
    event.preventDefault();
    event.stopPropagation();
    requireRegistration(
      () => toggle.mutate({ item, isFavorite }),
      "Сохраните контакты, чтобы добавлять объявления в избранное.",
    );
  }

  return (
    <button
      type="button"
      className={`heart-btn${isFavorite ? " heart-btn--active" : ""}`}
      data-testid="favorite-toggle"
      onClick={handleClick}
      aria-pressed={isFavorite}
      aria-label={isFavorite ? "Убрать из избранного" : "В избранное"}
      disabled={toggle.isPending}
    >
      <svg viewBox="0 0 24 24" fill={isFavorite ? "currentColor" : "none"} stroke="currentColor" strokeWidth="2">
        <path
          d="M12 21s-7.5-4.6-10-9.1C.5 8.7 2 5 5.6 5 8 5 10 6.4 12 9c2-2.6 4-4 6.4-4C22 5 23.5 8.7 21 11.9 19.5 16.4 12 21 12 21Z"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </button>
  );
}
