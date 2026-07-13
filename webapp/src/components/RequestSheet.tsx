import {
  createRequestInput,
  REQUEST_COMMENT_MAX,
  type CatalogType,
  type CreateRequestInput,
  type PriceType,
  type Request,
} from "@agromarket/contracts";
import { useMutation } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import { ApiError, apiPost } from "../lib/api";
import { useAuth } from "../lib/auth";
import { zodFieldErrors } from "../lib/formErrors";
import { sharePhoneFromTelegram } from "../lib/shareContact";
import { isTelegramContext } from "../lib/telegram";
import { BottomSheet } from "./BottomSheet";
import { ContactFields } from "./ContactFields";
import { SuccessCheck } from "./SuccessCheck";

export type RequestSource =
  | { source: "card"; cardId: string; cardTitle: string; tabType: CatalogType; priceType: PriceType }
  | { source: "tab"; tabType: CatalogType }
  | { source: "profile" };

const cardSubmitLabel: Record<PriceType, string> = {
  fixed: "Заказать звонок",
  from: "Уточнить стоимость",
  on_request: "Запросить цену",
};

interface RequestSheetProps {
  open: boolean;
  onClose: () => void;
  source: RequestSource;
}

/** Шторка формы заявки — три источника (карточка/вкладка/профиль), общая для всего Этапа 6. */
export function RequestSheet({ open, onClose, source }: RequestSheetProps) {
  const [pending, setPending] = useState(false);
  return (
    <BottomSheet open={open} onClose={onClose} closeDisabled={pending}>
      <RequestSheetContent source={source} onClose={onClose} onPendingChange={setPending} />
    </BottomSheet>
  );
}

function RequestSheetContent({
  source,
  onClose,
  onPendingChange,
}: {
  source: RequestSource;
  onClose: () => void;
  onPendingChange: (pending: boolean) => void;
}) {
  const { profile, refreshProfile } = useAuth();

  const [name, setName] = useState(
    profile?.contactName
      ?? [profile?.telegramFirstName, profile?.telegramLastName].filter(Boolean).join(" "),
  );
  const [phone, setPhone] = useState(profile?.contactPhone ?? "");
  const [comment, setComment] = useState("");
  const [contactResponse, setContactResponse] = useState<string | undefined>();
  const [clientRequestId, setClientRequestId] = useState(() => crypto.randomUUID());
  const [effectiveSource, setEffectiveSource] = useState<RequestSource>(source);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [success, setSuccess] = useState<Request | null>(null);
  const [cardUnavailable, setCardUnavailable] = useState(false);
  const [sharing, setSharing] = useState(false);
  const submitLabel = effectiveSource.source === "card"
    ? cardSubmitLabel[effectiveSource.priceType]
    : "Отправить заявку";

  const mutation = useMutation({
    mutationFn: (input: CreateRequestInput) => apiPost<Request>("/requests", input),
    onMutate: () => onPendingChange(true),
    onSettled: () => onPendingChange(false),
  });

  async function handleShareContact() {
    setSharing(true);
    const shared = await sharePhoneFromTelegram();
    setSharing(false);
    if (!shared) {
      setErrors((current) => ({ ...current, share: "Можно ввести номер вручную." }));
      return;
    }
    setPhone(shared.phone);
    setContactResponse(shared.contactResponse);
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setErrors({});

    const sourceFields = effectiveSource.source === "card"
      ? { source: "card" as const, cardId: effectiveSource.cardId }
      : effectiveSource.source === "tab"
        ? { source: "tab" as const, tabType: effectiveSource.tabType }
        : { source: "profile" as const };
    const parsed = createRequestInput.safeParse({
      ...sourceFields,
      clientRequestId,
      contactName: name,
      contactPhone: phone,
      contactResponse,
      comment
    });
    if (!parsed.success) {
      setErrors(zodFieldErrors(parsed.error));
      return;
    }

    try {
      const request = await mutation.mutateAsync(parsed.data);
      setSuccess(request);
      if (!profile?.isRegistered) await refreshProfile().catch(() => undefined);
    } catch (error) {
      if (error instanceof ApiError && error.status === 409 && error.message.includes("недоступно")) {
        setCardUnavailable(true);
      }
      setErrors({ form: error instanceof ApiError ? error.message : "Не удалось отправить заявку" });
    }
  }

  if (success) {
    const title = success.cardTitleSnapshot;
    return (
      <div className="sheet-result">
        <SuccessCheck
          title="Заявка принята"
          description={title
            ? `По объявлению «${title}». Менеджер свяжется с вами по номеру ${success.contactPhone} в рабочее время.`
            : `Менеджер свяжется с вами по номеру ${success.contactPhone} в рабочее время.`}
        />
        <p className="muted">Проверьте, что телефон доступен для звонка или WhatsApp.</p>
        <button type="button" className="button button-primary" onClick={onClose}>
          {source.source === "profile" ? "Готово" : "Продолжить просмотр"}
        </button>
      </div>
    );
  }

  return (
    <form className="form" onSubmit={handleSubmit} noValidate aria-busy={mutation.isPending}>
      <h2 className="screen-title">Оставить заявку</h2>

      <ContactFields
        name={name}
        phone={phone}
        onNameChange={setName}
        onPhoneChange={(value) => { setPhone(value); setContactResponse(undefined); }}
        errors={errors}
        showShare={false}
      />

      {!profile?.isRegistered && isTelegramContext() && (
        <button type="button" className="button button-secondary" onClick={handleShareContact} disabled={sharing || mutation.isPending}>
          {sharing ? "Получаем номер…" : "Поделиться номером из Telegram"}
        </button>
      )}
      {errors.share && <p className="muted" role="status">{errors.share}</p>}

      <label className="field">
        <span className="field-label">Комментарий (необязательно)</span>
        <textarea
          className="input input--textarea"
          value={comment}
          onChange={(e) => setComment(e.target.value)}
          maxLength={REQUEST_COMMENT_MAX}
          rows={3}
          placeholder="Например, удобное время для звонка"
        />
      </label>

      {errors.form && <p className="field-error" role="alert">{errors.form}</p>}

      {cardUnavailable && effectiveSource.source === "card" && (
        <button
          type="button"
          className="button button-secondary"
          onClick={() => {
            setEffectiveSource({ source: "tab", tabType: effectiveSource.tabType });
            setClientRequestId(crypto.randomUUID());
            setCardUnavailable(false);
            setErrors({});
          }}
        >
          Оставить общую заявку
        </button>
      )}

      <button
        type="submit"
        className="button button-primary"
        data-testid="request-submit"
        disabled={mutation.isPending}
      >
        {mutation.isPending ? "Отправляем…" : submitLabel}
      </button>
      <span className="visually-hidden" role="status" aria-live="polite">
        {mutation.isPending ? "Заявка отправляется. Дождитесь результата." : ""}
      </span>
    </form>
  );
}
