import {
  catalogTypeLabels,
  createCardInput,
  publishCardInput,
  DESCRIPTION_MAX,
  CARD_TITLE_MAX,
  priceTypeLabels,
  productLocationLabels,
  productOwnershipFormLabels,
  type AdminCardDetail,
  type CardDetail,
  type CatalogType,
  type CreateCardInput,
  type PriceType,
  type ProductLocation,
  type ProductOwnershipForm,
  type TerritoryCode
} from "@agromarket/contracts";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate, useParams, useSearch } from "@tanstack/react-router";
import { useEffect, useState, type FormEvent } from "react";
import { ConfirmSheet } from "../../components/admin/ConfirmSheet";
import { ImagePicker } from "../../components/admin/ImagePicker";
import { Segmented } from "../../components/admin/Segmented";
import { SpecsEditor, type SpecRow } from "../../components/admin/SpecsEditor";
import { ErrorState } from "../../components/ErrorState";
import { BottomSheet } from "../../components/BottomSheet";
import { CardDetailsView } from "../../components/CardDetailsView";
import { Screen } from "../../components/Screen";
import { SkeletonList } from "../../components/Skeleton";
import { ApiError, apiDelete, apiGet, apiPost, apiPut, formatApiError, isAmbiguousMutationError } from "../../lib/api";
import { cardMatchesInput, PublishAfterSaveError } from "../../lib/cardMutation";
import { clearCardDraft, loadCardDraft, saveCardDraft, type CardDraft } from "../../lib/cardDraft";
import { zodFieldErrorsByPath } from "../../lib/formErrors";
import { getLivePublicationIssues } from "../../lib/publicationChecklist";
import { adminCardQueryOptions, adminCategoriesQueryOptions, territoriesQueryOptions } from "../../lib/queries";
import type { AdminTypeSearch } from "../../lib/searchParams";
import { hapticNotify } from "../../lib/telegram";
import { useDebouncedValue } from "../../lib/useDebouncedValue";
import { useImageUploads, type DraftImage } from "../../lib/useImageUploads";

const typeOptions: { value: CatalogType; label: string }[] = [
  { value: "service", label: catalogTypeLabels.service },
  { value: "product", label: catalogTypeLabels.product }
];

const priceTypeOptions: { value: PriceType; label: string }[] = [
  { value: "fixed", label: priceTypeLabels.fixed },
  { value: "from", label: priceTypeLabels.from },
  { value: "on_request", label: priceTypeLabels.on_request }
];

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function CardEditorScreen() {
  const { cardId } = useParams({ strict: false }) as { cardId?: string };
  return cardId ? <CardEditorEdit cardId={cardId} /> : <CardEditorCreate />;
}

function CardEditorEdit({ cardId }: { cardId: string }) {
  const { data, isPending, isError, refetch } = useQuery(adminCardQueryOptions(cardId));
  const [recoveryError, setRecoveryError] = useState<string | undefined>();

  return (
    <Screen back title="Карточка" fallbackTo="/admin/cards">
      {isPending && <SkeletonList />}
      {isError && <ErrorState onRetry={refetch} />}
      {data && (
        <CardEditorForm
          key={data.version}
          mode="edit"
          initial={data}
          recoveryError={recoveryError}
          onRecoveryError={setRecoveryError}
        />
      )}
    </Screen>
  );
}

function CardEditorCreate() {
  const search = useSearch({ strict: false }) as AdminTypeSearch;
  const [draft, setDraft] = useState<CardDraft | null | undefined>(undefined);
  const [confirmed, setConfirmed] = useState(false);

  useEffect(() => {
    setDraft(loadCardDraft());
  }, []);

  if (draft === undefined) return null;

  if (draft && !confirmed) {
    return (
      <Screen back title="Новая карточка" fallbackTo="/admin/cards">
        <div className="form">
          <h2 className="screen-title">Продолжить черновик?</h2>
          <p className="description">У вас есть незавершённая карточка «{draft.title || "без названия"}».</p>
          <div className="sheet-actions">
            <button type="button" className="button button-primary" onClick={() => setConfirmed(true)}>
              Продолжить
            </button>
            <button
              type="button"
              className="button button-secondary"
              onClick={() => {
                clearCardDraft();
                setDraft(null);
                setConfirmed(true);
              }}
            >
              Начать заново
            </button>
          </div>
        </div>
      </Screen>
    );
  }

  return (
    <Screen back title="Новая карточка" fallbackTo="/admin/cards">
      <CardEditorForm mode="create" initialType={search.type} draft={confirmed ? draft ?? undefined : undefined} />
    </Screen>
  );
}

interface CardEditorFormProps {
  mode: "create" | "edit";
  initial?: AdminCardDetail;
  initialType?: CatalogType;
  draft?: CardDraft;
  recoveryError?: string;
  onRecoveryError?: (message: string | undefined) => void;
}

function CardEditorForm({
  mode,
  initial,
  initialType,
  draft,
  recoveryError,
  onRecoveryError,
}: CardEditorFormProps) {
  const navigate = useNavigate();
  const qc = useQueryClient();

  const [type, setType] = useState<CatalogType>(initial?.type ?? draft?.type ?? initialType ?? "service");
  const [categoryId, setCategoryId] = useState(initial?.categoryId ?? draft?.categoryId ?? "");
  const [title, setTitle] = useState(initial?.title ?? draft?.title ?? "");
  const [description, setDescription] = useState(initial?.description ?? draft?.description ?? "");
  const [priceType, setPriceType] = useState<PriceType>(initial?.priceType ?? draft?.priceType ?? "fixed");
  const [priceAmount, setPriceAmount] = useState(
    initial?.priceAmount != null ? String(initial.priceAmount) : draft?.priceAmount ?? ""
  );
  const [priceUnit, setPriceUnit] = useState(initial?.priceUnit ?? draft?.priceUnit ?? "");
  const [priceReason, setPriceReason] = useState(initial?.priceReason ?? draft?.priceReason ?? "");
  const [territoryCode, setTerritoryCode] = useState<TerritoryCode | "">(initial?.territory?.code ?? draft?.territoryCode ?? "");
  const [ownershipForm, setOwnershipForm] = useState<ProductOwnershipForm | "">(initial?.ownershipForm ?? draft?.ownershipForm ?? "");
  const [productLocation, setProductLocation] = useState<ProductLocation | "">(initial?.productLocation ?? draft?.productLocation ?? "");
  const [productLocationDetail, setProductLocationDetail] = useState(initial?.productLocationDetail ?? draft?.productLocationDetail ?? "");
  const [serviceAllKazakhstan, setServiceAllKazakhstan] = useState(initial?.serviceAllKazakhstan ?? draft?.serviceAllKazakhstan ?? false);
  const [serviceTerritoryCodes, setServiceTerritoryCodes] = useState<TerritoryCode[]>(
    initial?.serviceTerritories.map((territory) => territory.code) ?? draft?.serviceTerritoryCodes ?? []
  );
  const [availability, setAvailability] = useState(initial?.availability ?? draft?.availability ?? "");
  const [specs, setSpecs] = useState<SpecRow[]>(
    (initial?.specs ?? draft?.specs ?? []).map((s) => ({ localId: crypto.randomUUID(), key: s.key, value: s.value }))
  );
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [saveAction, setSaveAction] = useState<"draft" | "publish" | null>(null);
  const [typeChange, setTypeChange] = useState<CatalogType | null>(null);
  const [createClientRequestId] = useState<string | undefined>(() => {
    if (mode !== "create") return undefined;
    return draft?.clientRequestId && UUID_PATTERN.test(draft.clientRequestId)
      ? draft.clientRequestId
      : crypto.randomUUID();
  });
  const [updateMutationId] = useState<string | undefined>(() => mode === "edit" ? crypto.randomUUID() : undefined);

  useEffect(() => {
    if (recoveryError) setErrors((current) => ({ ...current, form: recoveryError }));
  }, [recoveryError]);

  const initialImages: DraftImage[] =
    initial?.images.map((img) => ({ storagePath: img.storagePath, publicUrl: img.url })) ?? draft?.images ?? [];
  const imageUploads = useImageUploads(initialImages);

  const categoriesQuery = useQuery(adminCategoriesQueryOptions(type));
  const territoriesQuery = useQuery(territoriesQueryOptions);
  const selectedCategory = categoriesQuery.data?.find((category) => category.id === categoryId);

  useEffect(() => {
    const required = selectedCategory?.requiredSpecs ?? [];
    if (required.length === 0) return;
    setSpecs((current) => {
      const keys = new Set(current.map((spec) => spec.key.trim().toLocaleLowerCase("ru")));
      const missing = required.filter((key) => !keys.has(key.trim().toLocaleLowerCase("ru")));
      if (missing.length === 0) return current;
      return [
        ...current,
        ...missing.map((key) => ({ localId: crypto.randomUUID(), key, value: "" })),
      ];
    });
  }, [selectedCategory?.requiredSpecs]);

  function invalidateCatalogQueries(cardId?: string) {
    qc.invalidateQueries({ queryKey: ["admin-cards"] });
    qc.invalidateQueries({ queryKey: ["admin-categories"] });
    qc.invalidateQueries({ queryKey: ["cards"] });
    qc.invalidateQueries({ queryKey: ["categories"] });
    if (cardId) qc.invalidateQueries({ queryKey: ["card", cardId] });
  }

  function finishSavedCard(card: AdminCardDetail) {
    cacheSavedCard(card);
    if (mode === "create") clearCardDraft();
    hapticNotify("success");
    navigate({ href: mode === "create" ? `/admin/cards/${card.id}` : "/admin/cards" });
  }

  function cacheSavedCard(card: AdminCardDetail) {
    qc.setQueryData(adminCardQueryOptions(card.id).queryKey, card);
    invalidateCatalogQueries(card.id);
  }

  async function refreshSavedCard(card: AdminCardDetail): Promise<AdminCardDetail> {
    cacheSavedCard(card);
    try {
      const current = await apiGet<AdminCardDetail>(`/admin/cards/${card.id}`);
      cacheSavedCard(current);
      return current;
    } catch {
      return card;
    }
  }

  /** После сетевой ошибки перечитываем карточку напрямую, минуя staleTime React Query. */
  async function reconcileCardMutation(cardId: string): Promise<"exists" | "deleted" | "unknown"> {
    try {
      const card = await apiGet<AdminCardDetail>(`/admin/cards/${cardId}`);
      qc.setQueryData(adminCardQueryOptions(cardId).queryKey, card);
      invalidateCatalogQueries(cardId);
      return "exists";
    } catch (error) {
      invalidateCatalogQueries(cardId);
      if (error instanceof ApiError && error.status === 404) return "deleted";
      return "unknown";
    }
  }

  /** Проверяет неоднозначный PUT/POST и при необходимости повторяет только публикацию. */
  async function reconcileSaveMutation(
    cardId: string,
    input: CreateCardInput,
    publish: boolean,
    error: unknown,
  ): Promise<boolean> {
    if (!isAmbiguousMutationError(error) || !initial || !input.mutationId) return false;
    let current: AdminCardDetail;
    try {
      current = await apiGet<AdminCardDetail>(
        `/admin/cards/${cardId}?mutationId=${encodeURIComponent(input.mutationId)}`,
      );
    } catch {
      return false;
    }
    qc.setQueryData(adminCardQueryOptions(cardId).queryKey, current);
    invalidateCatalogQueries(cardId);
    if (!cardMatchesInput(current, input, initial.version)) return false;

    if (!publish || current.publicationStatus === "published") {
      finishSavedCard(current);
      return true;
    }

    try {
      const published = await apiPost<AdminCardDetail>(`/admin/cards/${cardId}/publish`, {
        expectedVersion: current.version,
      });
      finishSavedCard(published);
      return true;
    } catch {
      try {
        const afterPublish = await apiGet<AdminCardDetail>(`/admin/cards/${cardId}`);
        if (afterPublish.publicationStatus === "published") {
          finishSavedCard(afterPublish);
          return true;
        }
      } catch {
        // Показываем исходную ошибку, если проверка после publish тоже недоступна.
      }
      return false;
    }
  }

  /** Replay-safe reconciliation for a create request whose response may have been lost. */
  async function reconcileCreateMutation(
    input: CreateCardInput,
    publish: boolean,
    error: unknown,
  ): Promise<boolean> {
    if (mode !== "create" || !createClientRequestId || !isAmbiguousMutationError(error)) return false;
    let current: AdminCardDetail;
    try {
      current = await apiGet<AdminCardDetail>(`/admin/cards/${createClientRequestId}`);
    } catch {
      return false;
    }
    qc.setQueryData(adminCardQueryOptions(current.id).queryKey, current);
    invalidateCatalogQueries(current.id);
    if (!cardMatchesInput(current, input, 0)) return false;

    if (!publish || current.publicationStatus === "published") {
      finishSavedCard(current);
      return true;
    }

    try {
      const published = await apiPost<AdminCardDetail>(`/admin/cards/${current.id}/publish`, {
        expectedVersion: current.version,
      });
      finishSavedCard(published);
      return true;
    } catch {
      try {
        const afterPublish = await apiGet<AdminCardDetail>(`/admin/cards/${current.id}`);
        if (afterPublish.publicationStatus === "published") {
          finishSavedCard(afterPublish);
          return true;
        }
      } catch {
        // Показываем исходную ошибку, если проверка после publish тоже недоступна.
      }
      return false;
    }
  }

  const saveMutation = useMutation({
    mutationFn: async ({
      input,
      publish,
    }: {
      input: ReturnType<typeof createCardInput.parse>;
      publish: boolean;
    }) => {
      const saved = mode === "edit" && initial
        ? await apiPut<AdminCardDetail>(`/admin/cards/${initial.id}`, { ...input, expectedVersion: initial.version })
        : await apiPost<AdminCardDetail>("/admin/cards", input);
      if (!publish) return saved;
      try {
        return await apiPost<AdminCardDetail>(`/admin/cards/${saved.id}/publish`, { expectedVersion: saved.version });
      } catch (error) {
        throw new PublishAfterSaveError(saved, error);
      }
    },
    onSuccess: finishSavedCard,
    onSettled: () => setSaveAction(null),
  });

  const archiveMutation = useMutation({
    mutationFn: () => apiPost<AdminCardDetail>(`/admin/cards/${initial!.id}/archive`, { expectedVersion: initial!.version }),
    onMutate: () => setErrors({}),
    onSuccess: (card) => {
      qc.setQueryData(adminCardQueryOptions(card.id).queryKey, card);
      invalidateCatalogQueries(card.id);
    },
    onError: (error) => {
      setErrors({ form: formatApiError(error, "Не удалось скрыть карточку") });
      void reconcileCardMutation(initial!.id).then((result) => {
        if (result === "deleted") navigate({ href: "/admin/cards" });
      });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: () => apiDelete(`/admin/cards/${initial!.id}`, { expectedVersion: initial!.version }),
    onMutate: () => setErrors({}),
    onSuccess: () => {
      qc.removeQueries({ queryKey: ["admin-card", initial!.id] });
      invalidateCatalogQueries();
      navigate({ href: "/admin/cards" });
    },
    onError: (error) => {
      setDeleteOpen(false);
      setErrors({ form: formatApiError(error, "Не удалось удалить карточку") });
      void reconcileCardMutation(initial!.id).then((result) => {
        if (result === "deleted") {
          qc.removeQueries({ queryKey: ["admin-card", initial!.id] });
          navigate({ href: "/admin/cards" });
        }
      });
    },
  });

  // Черновик — только для create, только когда есть что сохранять (пустая форма не пишется).
  const draftSnapshot = JSON.stringify({
    clientRequestId: createClientRequestId,
    type,
    categoryId,
    title,
    description,
    priceType,
    priceAmount,
    priceUnit,
    priceReason,
    territoryCode: territoryCode || undefined,
    ownershipForm: ownershipForm || undefined,
    productLocation: productLocation || undefined,
    productLocationDetail,
    serviceAllKazakhstan,
    serviceTerritoryCodes,
    availability,
    specs: specs.map(({ key, value }) => ({ key, value })),
    images: imageUploads.images.filter((img) => img.status === "done").map((img) => ({
      storagePath: img.storagePath!,
      publicUrl: img.publicUrl!
    }))
  } satisfies CardDraft);
  const debouncedSnapshot = useDebouncedValue(mode === "create" ? draftSnapshot : "", 500);

  useEffect(() => {
    if (mode !== "create" || !debouncedSnapshot) return;
    saveCardDraft(JSON.parse(debouncedSnapshot) as CardDraft);
  }, [debouncedSnapshot, mode]);

  function applyTypeChange(nextType: CatalogType) {
    setType(nextType);
    setCategoryId("");
    setTerritoryCode("");
    setOwnershipForm("");
    setProductLocation("");
    setProductLocationDetail("");
    setServiceAllKazakhstan(false);
    setServiceTerritoryCodes([]);
    setTypeChange(null);
  }

  function handleTypeChange(nextType: CatalogType) {
    if (nextType === type) return;
    if (categoryId || territoryCode || ownershipForm || productLocation || serviceTerritoryCodes.length > 0) {
      setTypeChange(nextType);
      return;
    }
    applyTypeChange(nextType);
  }

  function toggleServiceTerritory(code: TerritoryCode) {
    setServiceTerritoryCodes((current) => current.includes(code)
      ? current.filter((value) => value !== code)
      : [...current, code]);
  }

  function buildPayload(completeSpecsOnly = false) {
    const payloadSpecs = completeSpecsOnly
      ? specs.filter((spec) => spec.key.trim() && spec.value.trim())
      : specs;
    return {
      clientRequestId: mode === "create" ? createClientRequestId : undefined,
      mutationId: mode === "edit" ? updateMutationId : undefined,
      type,
      categoryId,
      title,
      description,
      sortOrder: initial?.sortOrder ?? 0,
      priceType,
      priceAmount: priceType === "on_request" || !priceAmount ? null : Number(priceAmount),
      priceUnit,
      priceReason: priceType === "fixed" ? null : priceReason,
      location: null,
      territoryCode: type === "product" ? territoryCode || null : null,
      ownershipForm: type === "product" ? ownershipForm || null : null,
      productLocation: type === "product" ? productLocation || null : null,
      productLocationDetail: type === "product" ? productLocationDetail || null : null,
      serviceAllKazakhstan: type === "service" && serviceAllKazakhstan,
      serviceTerritoryCodes: type === "service" && !serviceAllKazakhstan ? serviceTerritoryCodes : [],
      availability,
      images: imageUploads.images
        .filter((img) => img.status === "done")
        .map((img, idx) => ({ storagePath: img.storagePath!, sortOrder: idx })),
      specs: payloadSpecs.map((spec, idx) => ({ key: spec.key, value: spec.value, sortOrder: idx })),
    };
  }

  const livePayload = buildPayload();
  const livePublicationIssues = getLivePublicationIssues({
    title,
    categoryId,
    categoryState: categoriesQuery.isPending || categoriesQuery.isFetching
      ? "loading"
      : categoriesQuery.isError
        ? "error"
        : "ready",
    categoryFound: selectedCategory !== undefined,
    requiredSpecs: selectedCategory?.requiredSpecs ?? [],
    type: livePayload.type,
    description: livePayload.description,
    priceType: livePayload.priceType,
    priceAmount: livePayload.priceAmount,
    priceUnit: livePayload.priceUnit || null,
    priceReason: livePayload.priceReason || null,
    territoryCode: livePayload.territoryCode,
    ownershipForm: livePayload.ownershipForm,
    productLocation: livePayload.productLocation,
    serviceAllKazakhstan: livePayload.serviceAllKazakhstan,
    serviceTerritoryCount: livePayload.serviceAllKazakhstan ? 1 : livePayload.serviceTerritoryCodes.length,
    availability: livePayload.availability || null,
    imageCount: livePayload.images.length,
    imagePending: imageUploads.images.some((image) => image.status === "compressing" || image.status === "uploading"),
    imageError: imageUploads.hasErrors,
    specs: livePayload.specs,
  });

  async function handleAction(action: "draft" | "publish") {
    setErrors({});
    onRecoveryError?.(undefined);
    // Незавершённая строка характеристики не должна мешать сохранить серверный черновик.
    // При публикации полный набор по-прежнему валидируется ниже и на сервере.
    const payload = buildPayload(action === "draft");
    if (action === "publish" && !imageUploads.isSettledNow()) {
      setErrors({ images: "Дождитесь завершения загрузки фото перед публикацией" });
      return;
    }
    const parsed = (action === "publish" ? publishCardInput : createCardInput).safeParse(payload);
    if (!parsed.success) {
      setErrors(zodFieldErrorsByPath(parsed.error));
      return;
    }

    if (action === "publish") {
      if (imageUploads.hasErrors) {
        setErrors({ images: "Исправьте ошибку загрузки фото перед публикацией" });
        return;
      }
      if (livePublicationIssues.length > 0) {
        setErrors({ form: `Сначала исправьте: ${livePublicationIssues.join("; ")}` });
        return;
      }
      const missingRequired = (selectedCategory?.requiredSpecs ?? []).filter((requiredKey) => {
        const normalized = requiredKey.trim().toLocaleLowerCase("ru");
        return !specs.some((spec) => spec.key.trim().toLocaleLowerCase("ru") === normalized && spec.value.trim());
      });
      if (missingRequired.length > 0) {
        setErrors({ form: `Заполните обязательные характеристики: ${missingRequired.join(", ")}` });
        return;
      }
    }

    try {
      setSaveAction(action);
      await saveMutation.mutateAsync({ input: parsed.data, publish: action === "publish" });
    } catch (error) {
      if (error instanceof PublishAfterSaveError) {
        const current = await refreshSavedCard(error.saved);
        if (isAmbiguousMutationError(error.publishError)) {
          if (await reconcileCreateMutation(parsed.data, true, error.publishError)) return;
          if (mode === "edit" && initial && await reconcileSaveMutation(initial.id, parsed.data, true, error.publishError)) {
            return;
          }
        }
        if (mode === "create") {
          if (current.publicationStatus === "published") {
            finishSavedCard(current);
            return;
          }
          // POST уже создал черновик, но publish вернул детерминированную ошибку.
          // Оставляем форму и draft на месте, чтобы пользователь исправил причину и повторил publish.
          const message = formatApiError(error.publishError, "Не удалось опубликовать карточку");
          setErrors({ form: message });
          onRecoveryError?.(message);
          return;
        }
        const message = formatApiError(error.publishError, "Не удалось опубликовать карточку");
        setErrors({ form: message });
        onRecoveryError?.(message);
        return;
      }
      if (await reconcileCreateMutation(parsed.data, action === "publish", error)) {
        return;
      }
      if (mode === "edit" && initial && await reconcileSaveMutation(initial.id, parsed.data, action === "publish", error)) {
        return;
      }
      const message = formatApiError(error, "Не удалось сохранить карточку");
      setErrors({ form: message });
      onRecoveryError?.(message);
    }
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    await handleAction("draft");
  }

  const canSave = imageUploads.settled && !saveMutation.isPending;
  const canPublish = canSave && livePublicationIssues.length === 0;
  const previewPayload = livePayload;
  const previewCard: CardDetail = {
    id: initial?.id ?? "00000000-0000-4000-8000-000000000001",
    type,
    categoryId: categoryId || "00000000-0000-4000-8000-000000000002",
    title: title || "Карточка без названия",
    description,
    priceType,
    priceAmount: previewPayload.priceAmount,
    priceUnit: priceUnit || null,
    priceReason: priceType === "fixed" ? null : priceReason || null,
    location: null,
    territory: type === "product"
      ? territoriesQuery.data?.find((territory) => territory.code === territoryCode) ?? null
      : null,
    ownershipForm: type === "product" ? ownershipForm || null : null,
    productLocation: type === "product" ? productLocation || null : null,
    productLocationDetail: type === "product" ? productLocationDetail || null : null,
    serviceAllKazakhstan: type === "service" && serviceAllKazakhstan,
    serviceTerritories: type === "service"
      ? (territoriesQuery.data ?? []).filter((territory) => serviceTerritoryCodes.includes(territory.code))
      : [],
    availability: availability || null,
    sortOrder: initial?.sortOrder ?? 0,
    version: initial?.version ?? 1,
    publishedAt: initial?.publishedAt ?? null,
    archivedAt: initial?.archivedAt ?? null,
    createdAt: initial?.createdAt ?? new Date().toISOString(),
    updatedAt: initial?.updatedAt ?? new Date().toISOString(),
    images: imageUploads.images
      .filter((image) => image.status === "done")
      .map((image, index) => ({
        id: `00000000-0000-4000-8000-${String(index + 10).padStart(12, "0")}`,
        storagePath: image.storagePath!,
        url: image.publicUrl!,
        altText: null,
        sortOrder: index,
      })),
    specs: specs.filter((spec) => spec.key.trim() && spec.value.trim()).map((spec, index) => ({
      id: `00000000-0000-4000-8000-${String(index + 100).padStart(12, "0")}`,
      key: spec.key,
      value: spec.value,
      sortOrder: index,
    })),
  };

  return (
    <form className="form" onSubmit={handleSubmit} noValidate>
      <Segmented options={typeOptions} value={type} onChange={handleTypeChange} ariaLabel="Тип карточки" />

      <label className="field">
        <span className="field-label">Категория</span>
        <select
          className="input"
          data-testid="card-editor-category"
          value={categoryId}
          onChange={(e) => setCategoryId(e.target.value)}
        >
          <option value="">Выберите категорию</option>
          {(categoriesQuery.data ?? []).map((category) => (
            <option key={category.id} value={category.id}>
              {category.name}
            </option>
          ))}
        </select>
        {errors.categoryId && <span className="field-error">{errors.categoryId}</span>}
      </label>

      <label className="field">
        <span className="field-label">Название</span>
        <input
          className="input"
          data-testid="card-editor-title"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          maxLength={CARD_TITLE_MAX}
        />
        {errors.title && <span className="field-error">{errors.title}</span>}
      </label>

      <label className="field">
        <span className="field-label">Описание</span>
        <textarea
          className="input input--textarea"
          data-testid="card-editor-description"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          maxLength={DESCRIPTION_MAX}
          rows={4}
        />
        {errors.description && <span className="field-error">{errors.description}</span>}
      </label>

      <Segmented options={priceTypeOptions} value={priceType} onChange={setPriceType} ariaLabel="Тип цены" />

      {priceType !== "on_request" && (
        <label className="field">
          <span className="field-label">Цена, ₸</span>
          <input
            className="input"
            data-testid="card-editor-price"
            value={priceAmount}
            onChange={(e) => setPriceAmount(e.target.value.replace(/[^\d]/g, ""))}
            inputMode="numeric"
          />
          {errors.priceAmount && <span className="field-error">{errors.priceAmount}</span>}
        </label>
      )}

      <label className="field">
        <span className="field-label">Цена указана за</span>
        <input
          className="input"
          data-testid="card-editor-price-unit"
          list="price-unit-options"
          value={priceUnit}
          onChange={(event) => setPriceUnit(event.target.value)}
          placeholder="Например, за тонну"
        />
        <datalist id="price-unit-options">
          <option value="за тонну" />
          <option value="за килограмм" />
          <option value="за штуку" />
          <option value="за голову" />
          <option value="за гектар" />
          <option value="за час" />
          <option value="за рейс" />
          <option value="за всю услугу" />
        </datalist>
        {errors.priceUnit && <span className="field-error">{errors.priceUnit}</span>}
      </label>

      {priceType !== "fixed" && (
        <label className="field">
          <span className="field-label">
            {priceType === "on_request" ? "Почему цена рассчитывается индивидуально?" : "Пояснение к цене (необязательно)"}
          </span>
          <textarea
            className="input input--textarea"
            value={priceReason}
            onChange={(event) => setPriceReason(event.target.value)}
            rows={3}
          />
          {errors.priceReason && <span className="field-error">{errors.priceReason}</span>}
        </label>
      )}

      {type === "product" ? (
        <>
          <label className="field">
            <span className="field-label">Регион</span>
            <select
              className="input"
              data-testid="card-editor-territory"
              value={territoryCode}
              onChange={(event) => setTerritoryCode(event.target.value as TerritoryCode | "")}
              disabled={territoriesQuery.isPending}
            >
              <option value="">Выберите регион</option>
              {(territoriesQuery.data ?? []).map((territory) => (
                <option key={territory.code} value={territory.code}>{territory.name}</option>
              ))}
            </select>
            {errors.territoryCode && <span className="field-error">{errors.territoryCode}</span>}
          </label>
          <label className="field">
            <span className="field-label">Форма собственности</span>
            <select className="input" value={ownershipForm} onChange={(event) => setOwnershipForm(event.target.value as ProductOwnershipForm | "")}>
              <option value="">Выберите форму</option>
              {Object.entries(productOwnershipFormLabels).map(([value, label]) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </select>
            {errors.ownershipForm && <span className="field-error">{errors.ownershipForm}</span>}
          </label>
          <label className="field">
            <span className="field-label">Местонахождение товара</span>
            <select className="input" value={productLocation} onChange={(event) => setProductLocation(event.target.value as ProductLocation | "")}>
              <option value="">Выберите местонахождение</option>
              {Object.entries(productLocationLabels).map(([value, label]) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </select>
            {errors.productLocation && <span className="field-error">{errors.productLocation}</span>}
          </label>
          <label className="field">
            <span className="field-label">Уточнение места (необязательно)</span>
            <input className="input" value={productLocationDetail} onChange={(event) => setProductLocationDetail(event.target.value)} maxLength={200} />
          </label>
        </>
      ) : (
        <fieldset className="field listing-territories">
          <legend className="field-label">География услуги</legend>
          <label className="check-row">
            <input type="checkbox" checked={serviceAllKazakhstan} onChange={(event) => setServiceAllKazakhstan(event.target.checked)} />
            <span>Весь Казахстан</span>
          </label>
          {!serviceAllKazakhstan && (
            <div className="territory-checklist" role="group" aria-label="Регионы работы услуги">
              {(territoriesQuery.data ?? []).map((territory) => (
                <label className="check-row" key={territory.code}>
                  <input type="checkbox" checked={serviceTerritoryCodes.includes(territory.code)} onChange={() => toggleServiceTerritory(territory.code)} />
                  <span>{territory.name}</span>
                </label>
              ))}
            </div>
          )}
          {errors.serviceTerritoryCodes && <span className="field-error">{errors.serviceTerritoryCodes}</span>}
        </fieldset>
      )}

      <label className="field">
        <span className="field-label">Наличие, срок поставки или исполнения</span>
        <input className="input" data-testid="card-editor-availability" value={availability} onChange={(event) => setAvailability(event.target.value)} />
        {errors.availability && <span className="field-error">{errors.availability}</span>}
      </label>

      {mode === "create" ? (
        <div className="card notice-card">
          <p className="eyebrow">Фото после черновика</p>
          <p className="description">Сначала сохраните серверный черновик. Затем добавьте фото и опубликуйте карточку.</p>
        </div>
      ) : (
        <ImagePicker
          images={imageUploads.images}
          onAdd={imageUploads.addFiles}
          onRemove={imageUploads.remove}
          onMakeCover={imageUploads.makeCover}
          onRetry={imageUploads.retry}
          error={errors.images}
        />
      )}

      <SpecsEditor
        specs={specs}
        onChange={setSpecs}
        errors={errors}
        requiredKeys={selectedCategory?.requiredSpecs}
      />

      {livePublicationIssues.length > 0 && (
        <div className="card notice-card">
          <p className="eyebrow">Нужно дополнить</p>
          <ul data-testid="card-editor-publication-issues">
            {livePublicationIssues.map((issue) => <li key={issue}>{issue}</li>)}
          </ul>
        </div>
      )}

      {errors.form && <p className="field-error" role="alert">{errors.form}</p>}

      <button type="submit" className="button button-primary" data-testid="card-editor-save" disabled={!canSave}>
        {saveMutation.isPending && saveAction === "draft"
          ? "Сохраняем…"
          : initial?.publicationStatus === "published"
            ? "Сохранить изменения"
            : "Сохранить черновик"}
      </button>

      <button type="button" className="button button-secondary" onClick={() => setPreviewOpen(true)}>
        Предпросмотр
      </button>

      {mode === "edit" && initial?.publicationStatus !== "published" && (
        <button
          type="button"
          className="button button-primary"
          data-testid="card-editor-publish"
          disabled={!canPublish}
          onClick={() => handleAction("publish")}
        >
          {saveMutation.isPending && saveAction === "publish"
            ? "Публикуем…"
            : initial?.publicationStatus === "archived"
              ? "Опубликовать снова"
              : "Опубликовать"}
        </button>
      )}

      {mode === "edit" && initial && (
        <>
          {initial.publicationStatus === "published" && (
            <button type="button" className="button button-secondary" onClick={() => archiveMutation.mutate()} disabled={archiveMutation.isPending}>
              {archiveMutation.isPending ? "Скрываем…" : "Скрыть от пользователей"}
            </button>
          )}
          <button
            type="button"
            className="button button-danger"
            data-testid="card-editor-delete"
            onClick={() => setDeleteOpen(true)}
          >
            Удалить карточку
          </button>
        </>
      )}

      <BottomSheet open={previewOpen} onClose={() => setPreviewOpen(false)}>
        <div className="form">
          <p className="eyebrow">Предпросмотр карточки</p>
          <CardDetailsView card={previewCard} />
          <button type="button" className="button button-primary" onClick={() => setPreviewOpen(false)}>Вернуться к редактированию</button>
        </div>
      </BottomSheet>

      <ConfirmSheet
        open={deleteOpen}
        title="Удалить карточку?"
        description={`Карточка «${initial?.title}» будет удалена без возможности восстановления.`}
        confirmLabel="Удалить"
        danger
        pending={deleteMutation.isPending}
        onConfirm={() => deleteMutation.mutate()}
        onClose={() => setDeleteOpen(false)}
      />
      <ConfirmSheet
        open={typeChange !== null}
        title="Сменить тип карточки?"
        description="Параметры региона, формы собственности и географии услуги будут очищены. Другие данные карточки сохранятся."
        confirmLabel="Сменить тип"
        onConfirm={() => { if (typeChange) applyTypeChange(typeChange); }}
        onClose={() => setTypeChange(null)}
      />
    </form>
  );
}
