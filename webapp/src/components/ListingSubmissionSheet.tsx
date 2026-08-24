import {
  createRequestInput,
  commodityGroupLabels,
  productLocationLabels,
  productOwnershipFormLabels,
  PRODUCT_LOCATION_DETAIL_MAX,
  REQUEST_COMMENT_MAX,
  type CatalogType,
  type CommodityGroup,
  type CreateRequestInput,
  type Request,
  type TerritoryCode
} from "@agromarket/contracts";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useMemo, useState, type FormEvent } from "react";
import { ApiError, apiPost } from "../lib/api";
import { useAuth } from "../lib/auth";
import { zodFieldErrors } from "../lib/formErrors";
import { listingCategoriesQueryOptions, territoriesQueryOptions } from "../lib/queries";
import { sharePhoneFromTelegram } from "../lib/shareContact";
import { isTelegramContext } from "../lib/telegram";
import { BottomSheet } from "./BottomSheet";
import { ContactFields } from "./ContactFields";
import { ErrorState } from "./ErrorState";
import { SuccessCheck } from "./SuccessCheck";

interface ListingSubmissionSheetProps {
  open: boolean;
  onClose: () => void;
  type: CatalogType;
}

/** Структурированная форма предложения товара/услуги. Она создаёт заявку, а не публикует карточку автоматически. */
export function ListingSubmissionSheet({ open, onClose, type }: ListingSubmissionSheetProps) {
  const [pending, setPending] = useState(false);
  return (
    <BottomSheet open={open} onClose={onClose} closeDisabled={pending}>
      <ListingSubmissionForm type={type} onClose={onClose} onPendingChange={setPending} />
    </BottomSheet>
  );
}

function ListingSubmissionForm({
  type,
  onClose,
  onPendingChange
}: {
  type: CatalogType;
  onClose: () => void;
  onPendingChange: (pending: boolean) => void;
}) {
  const { profile, refreshProfile } = useAuth();
  const categoriesQuery = useQuery(listingCategoriesQueryOptions(type));
  const territoriesQuery = useQuery(territoriesQueryOptions);
  const territories = territoriesQuery.data ?? [];
  const [categoryId, setCategoryId] = useState("");
  const [territoryCode, setTerritoryCode] = useState<TerritoryCode | "">("");
  const [ownershipForm, setOwnershipForm] = useState<keyof typeof productOwnershipFormLabels | "">("");
  const [productLocation, setProductLocation] = useState<keyof typeof productLocationLabels | "">("");
  const [productLocationDetail, setProductLocationDetail] = useState("");
  const [commodityGroup, setCommodityGroup] = useState<CommodityGroup | "">("");
  const [volumeTonnes, setVolumeTonnes] = useState("");
  const [allKazakhstan, setAllKazakhstan] = useState(false);
  const [territoryCodes, setTerritoryCodes] = useState<TerritoryCode[]>([]);
  const [name, setName] = useState(
    profile?.contactName ?? [profile?.telegramFirstName, profile?.telegramLastName].filter(Boolean).join(" ")
  );
  const [phone, setPhone] = useState(profile?.contactPhone ?? "");
  const [comment, setComment] = useState("");
  const [contactResponse, setContactResponse] = useState<string | undefined>();
  const [clientRequestId] = useState(() => crypto.randomUUID());
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [success, setSuccess] = useState<Request | null>(null);
  const [sharing, setSharing] = useState(false);

  const categories = categoriesQuery.data ?? [];
  const selectedCategory = categories.find((category) => category.id === categoryId);
  const title = type === "product" ? "Продать объём" : "Опубликовать услугу";
  const selectedTerritories = useMemo(() => new Set(territoryCodes), [territoryCodes]);
  const mutation = useMutation({
    mutationFn: (input: CreateRequestInput) => apiPost<Request>("/requests", input),
    onMutate: () => onPendingChange(true),
    onSettled: () => onPendingChange(false)
  });

  function toggleTerritory(code: TerritoryCode) {
    setTerritoryCodes((current) => current.includes(code)
      ? current.filter((value) => value !== code)
      : [...current, code]);
  }

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
    const listingSubmission = type === "product"
      ? {
          type: "product" as const,
          categoryId,
          territoryCode,
          ownershipForm,
          commodityGroup: selectedCategory?.isCommodity ? commodityGroup || undefined : undefined,
          volumeTonnes: selectedCategory?.isCommodity && volumeTonnes ? Number(volumeTonnes.replace(",", ".")) : undefined,
          productLocation: productLocation || undefined,
          productLocationDetail: productLocationDetail || undefined
        }
      : {
          type: "service" as const,
          categoryId,
          allKazakhstan,
          territoryCodes: allKazakhstan ? [] : territoryCodes
        };
    const parsed = createRequestInput.safeParse({
      source: "tab",
      tabType: type,
      listingSubmission,
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
      setErrors({ form: error instanceof ApiError ? error.message : "Не удалось отправить предложение" });
    }
  }

  if (success) {
    return (
      <div className="sheet-result">
        <SuccessCheck
          title="Предложение отправлено"
          description="Менеджер проверит данные и свяжется с вами. Объявление не публикуется автоматически."
        />
        <button type="button" className="button button-primary" onClick={onClose}>Продолжить просмотр</button>
      </div>
    );
  }

  if (categoriesQuery.isError || territoriesQuery.isError) {
    return <ErrorState onRetry={() => { void categoriesQuery.refetch(); void territoriesQuery.refetch(); }} />;
  }

  return (
    <form className="form listing-submission-form" onSubmit={handleSubmit} noValidate aria-busy={mutation.isPending}>
      <div>
        <h2 className="screen-title">{title}</h2>
        <p className="muted">Заполните данные — менеджер проверит их перед публикацией.</p>
      </div>

      <label className="field">
        <span className="field-label">Категория</span>
        <select className="input" value={categoryId} onChange={(event) => {
          const nextId = event.target.value;
          setCategoryId(nextId);
          const nextCategory = categories.find((category) => category.id === nextId);
          if (!nextCategory?.isCommodity) {
            setCommodityGroup("");
            setVolumeTonnes("");
          }
        }} disabled={categoriesQuery.isPending}>
          <option value="">Выберите категорию</option>
          {categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}
        </select>
      </label>

      {type === "product" ? (
        <>
          <label className="field">
            <span className="field-label">Область</span>
            <select className="input" value={territoryCode} onChange={(event) => setTerritoryCode(event.target.value as TerritoryCode | "")} disabled={territoriesQuery.isPending}>
              <option value="">Выберите регион</option>
              {territories.filter((territory) => territory.kind === "region").map((territory) => <option key={territory.code} value={territory.code}>{territory.name}</option>)}
            </select>
          </label>
          <label className="field">
            <span className="field-label">Форма собственности</span>
            <select className="input" value={ownershipForm} onChange={(event) => setOwnershipForm(event.target.value as keyof typeof productOwnershipFormLabels | "")}>
              <option value="">Выберите форму</option>
              {Object.entries(productOwnershipFormLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
          </label>
          {selectedCategory?.isCommodity && (
            <>
              <label className="field">
                <span className="field-label">Группа продукции</span>
                <select className="input" value={commodityGroup} onChange={(event) => setCommodityGroup(event.target.value as CommodityGroup | "")}>
                  <option value="">Выберите группу</option>
                  {Object.entries(commodityGroupLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                </select>
              </label>
              <label className="field">
                <span className="field-label">Объём, тонн</span>
                <input className="input" value={volumeTonnes} onChange={(event) => setVolumeTonnes(event.target.value.replace(/[^\d.,]/g, ""))} inputMode="decimal" placeholder="Например, 12,375" />
              </label>
            </>
          )}
          <label className="field">
            <span className="field-label">Местонахождение</span>
            <select className="input" value={productLocation} onChange={(event) => setProductLocation(event.target.value as keyof typeof productLocationLabels | "")}>
              <option value="">Выберите местонахождение</option>
              {Object.entries(productLocationLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
          </label>
          <label className="field">
            <span className="field-label">Уточнение места (необязательно)</span>
            <input className="input" value={productLocationDetail} onChange={(event) => setProductLocationDetail(event.target.value)} maxLength={PRODUCT_LOCATION_DETAIL_MAX} />
          </label>
        </>
      ) : (
        <fieldset className="field listing-territories">
          <legend className="field-label">География услуги</legend>
          <label className="check-row">
            <input type="checkbox" checked={allKazakhstan} onChange={(event) => setAllKazakhstan(event.target.checked)} />
            <span>Весь Казахстан</span>
          </label>
          {!allKazakhstan && (
            <div className="territory-checklist" role="group" aria-label="Регионы работы">
              {territories.map((territory) => (
                <label className="check-row" key={territory.code}>
                  <input type="checkbox" checked={selectedTerritories.has(territory.code)} onChange={() => toggleTerritory(territory.code)} />
                  <span>{territory.name}</span>
                </label>
              ))}
            </div>
          )}
        </fieldset>
      )}
      {errors.listingSubmission && <p className="field-error" role="alert">{errors.listingSubmission}</p>}

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
        <textarea className="input input--textarea" value={comment} onChange={(event) => setComment(event.target.value)} maxLength={REQUEST_COMMENT_MAX} rows={3} />
      </label>
      {errors.form && <p className="field-error" role="alert">{errors.form}</p>}
      <button type="submit" className="button button-primary" data-testid="listing-submission-submit" disabled={mutation.isPending || categoriesQuery.isPending || territoriesQuery.isPending}>
        {mutation.isPending ? "Отправляем…" : "Отправить на проверку"}
      </button>
    </form>
  );
}
