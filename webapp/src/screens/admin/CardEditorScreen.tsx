import {
  catalogTypeLabels,
  commodityGroupLabels,
  adminCardDetailSchema,
  createCardInput,
  publishCardInput,
  DESCRIPTION_MAX,
  CARD_TITLE_MAX,
  priceTypeLabels,
  productLocationLabels,
  productOwnershipFormLabels,
  type AdminCardDetail,
  type CatalogType,
  type CommodityGroup,
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
import { SpecsEditor } from "../../components/admin/SpecsEditor";
import { ErrorState } from "../../components/ErrorState";
import { BottomSheet } from "../../components/BottomSheet";
import { CardDetailsView } from "../../components/CardDetailsView";
import { Screen } from "../../components/Screen";
import { SkeletonList } from "../../components/Skeleton";
import {
  ApiError,
  apiDelete,
  apiGetParsed,
  apiPostParsed,
  apiPutParsed,
  formatApiError,
  isAmbiguousMutationError,
} from "../../lib/api";
import { PublishAfterSaveError } from "../../lib/cardMutation";
import { clearCardDraft, loadCardDraft, saveCardDraft, type CardDraft } from "../../lib/cardDraft";
import {
  changeEditorCategory,
  changeEditorType,
  createEditorState,
  syncRequiredSpecs,
  toDraft,
  toMutationInput,
  toPreview,
  toggleEditorServiceTerritory,
  type EditorState,
} from "../../lib/cardEditorModel";
import { zodFieldErrorsByPath } from "../../lib/formErrors";
import { getLivePublicationIssues } from "../../lib/publicationChecklist";
import {
  adminCardQueryOptions,
  adminCatalogQueryKeys,
  adminCategoriesQueryOptions,
  invalidateCatalogAfterAdminCardMutation,
  territoriesQueryOptions,
} from "../../lib/queries";
import type { AdminTypeSearch } from "../../lib/searchParams";
import { hapticNotify } from "../../lib/telegram";
import { useDebouncedValue } from "../../lib/useDebouncedValue";
import { useImageUploads } from "../../lib/useImageUploads";

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
          onRecoveryRefresh={async () => {
            const refreshed = await refetch({ throwOnError: true });
            if (!refreshed.data) throw new Error("Карточка не загрузилась после изменения");
          }}
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
  onRecoveryRefresh?: () => Promise<void>;
}

function CardEditorForm({
  mode,
  initial,
  initialType,
  draft,
  recoveryError,
  onRecoveryError,
  onRecoveryRefresh,
}: CardEditorFormProps) {
  const navigate = useNavigate();
  const qc = useQueryClient();

  const [editor, setEditor] = useState<EditorState>(() => createEditorState({ initial, draft, initialType }));
  const {
    type, categoryId, title, description, priceType, priceAmount, priceUnit, priceReason,
    territoryCode, ownershipForm, productLocation, productLocationDetail, commodityGroup,
    volumeTonnes, serviceAllKazakhstan, serviceTerritoryCodes, availability, specs,
  } = editor;
  const updateEditor = (patch: Partial<EditorState>) => setEditor((current) => ({ ...current, ...patch }));
  const setTitle = (value: string) => updateEditor({ title: value });
  const setDescription = (value: string) => updateEditor({ description: value });
  const setPriceType = (value: PriceType) => updateEditor({ priceType: value });
  const setPriceAmount = (value: string) => updateEditor({ priceAmount: value });
  const setPriceUnit = (value: string) => updateEditor({ priceUnit: value });
  const setPriceReason = (value: string) => updateEditor({ priceReason: value });
  const setTerritoryCode = (value: TerritoryCode | "") => updateEditor({ territoryCode: value });
  const setOwnershipForm = (value: ProductOwnershipForm | "") => updateEditor({ ownershipForm: value });
  const setProductLocation = (value: ProductLocation | "") => updateEditor({ productLocation: value });
  const setProductLocationDetail = (value: string) => updateEditor({ productLocationDetail: value });
  const setCommodityGroup = (value: CommodityGroup | "") => updateEditor({ commodityGroup: value });
  const setVolumeTonnes = (value: string) => updateEditor({ volumeTonnes: value });
  const setServiceAllKazakhstan = (value: boolean) => updateEditor({ serviceAllKazakhstan: value });
  const setAvailability = (value: string) => updateEditor({ availability: value });
  const setSpecs = (next: EditorState["specs"]) => updateEditor({ specs: next });
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
  type SaveAction = "draft" | "publish";
  type RecoveryResult = "committed" | "not_found" | "changed" | "rejected" | "unknown";
  type PendingSaveAttempt = {
    action: SaveAction;
    input: CreateCardInput;
    cardId?: string;
  };
  const [pendingSaveAttempt, setPendingSaveAttempt] = useState<PendingSaveAttempt | null>(null);
  const [isCheckingSave, setIsCheckingSave] = useState(false);

  useEffect(() => {
    if (recoveryError) setErrors((current) => ({ ...current, form: recoveryError }));
  }, [recoveryError]);

  const initialImages = initial?.images.map((img) => ({ storagePath: img.storagePath, publicUrl: img.url })) ?? draft?.images ?? [];
  const imageUploads = useImageUploads(initialImages);

  const categoriesQuery = useQuery(adminCategoriesQueryOptions(type));
  const territoriesQuery = useQuery(territoriesQueryOptions);
  const selectedCategory = categoriesQuery.data?.find((category) => category.id === categoryId);

  useEffect(() => {
    if (!selectedCategory || selectedCategory.isCommodity) return;
    setEditor((current) => changeEditorCategory(current, current.categoryId, false));
  }, [selectedCategory?.id, selectedCategory?.isCommodity]);

  useEffect(() => {
    const required = selectedCategory?.requiredSpecs ?? [];
    if (required.length === 0) return;
    setEditor((current) => syncRequiredSpecs(current, required));
  }, [selectedCategory?.requiredSpecs]);

  function invalidateCatalogQueries(cardId?: string) {
    invalidateCatalogAfterAdminCardMutation(qc, cardId);
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
      const current = await apiGetParsed<AdminCardDetail>(`/admin/cards/${card.id}`, adminCardDetailSchema);
      cacheSavedCard(current);
      return current;
    } catch {
      return card;
    }
  }

  /** После сетевой ошибки перечитываем карточку напрямую, минуя staleTime React Query. */
  async function reconcileCardMutation(cardId: string): Promise<"exists" | "deleted" | "unknown"> {
    try {
      const card = await apiGetParsed<AdminCardDetail>(`/admin/cards/${cardId}`, adminCardDetailSchema);
      qc.setQueryData(adminCardQueryOptions(cardId).queryKey, card);
      invalidateCatalogQueries(cardId);
      return "exists";
    } catch (error) {
      invalidateCatalogQueries(cardId);
      if (error instanceof ApiError && error.status === 404) return "deleted";
      return "unknown";
    }
  }

  async function verifyEditMutation(
    cardId: string,
    input: CreateCardInput,
    publish: boolean,
  ): Promise<RecoveryResult> {
    if (!initial || !input.mutationId) return "not_found";
    let current: AdminCardDetail;
    try {
      current = await apiGetParsed<AdminCardDetail>(
        `/admin/cards/${cardId}?mutationId=${encodeURIComponent(input.mutationId)}`,
        adminCardDetailSchema,
      );
    } catch (error) {
      if (error instanceof ApiError && error.code === "CARD_UPDATE_MUTATION_NOT_FOUND") return "not_found";
      if (error instanceof ApiError && error.code === "CARD_CHANGED_AFTER_REPLAY") {
        if (!publish) return "changed";
        try {
          const afterPublish = await apiGetParsed<AdminCardDetail>(`/admin/cards/${cardId}`, adminCardDetailSchema);
          if (afterPublish.publicationStatus === "published") {
            finishSavedCard(afterPublish);
            return "committed";
          }
          return "changed";
        } catch {
          return "unknown";
        }
      }
      return "unknown";
    }
    if (!publish || current.publicationStatus === "published") {
      finishSavedCard(current);
      return "committed";
    }

    try {
      const published = await apiPostParsed<AdminCardDetail>(`/admin/cards/${cardId}/publish`, {
        expectedVersion: current.version,
      }, adminCardDetailSchema);
      finishSavedCard(published);
      return "committed";
    } catch (error) {
      if (!isAmbiguousMutationError(error)) {
        cacheSavedCard(current);
        return "rejected";
      }
      try {
        const afterPublish = await apiGetParsed<AdminCardDetail>(`/admin/cards/${cardId}`, adminCardDetailSchema);
        if (afterPublish.publicationStatus === "published") {
          finishSavedCard(afterPublish);
          return "committed";
        }
      } catch {
        return "unknown";
      }
      return "unknown";
    }
  }

  /** Повторяет create с тем же clientRequestId: backend либо вернёт receipt, либо создаст запись. */
  async function verifyCreateMutation(
    input: CreateCardInput,
    publish: boolean,
  ): Promise<RecoveryResult> {
    if (mode !== "create" || !createClientRequestId) return "not_found";
    let current: AdminCardDetail;
    try {
      current = await apiPostParsed<AdminCardDetail>("/admin/cards", input, adminCardDetailSchema);
    } catch (error) {
      if (error instanceof ApiError && error.code === "CARD_CREATE_REQUEST_REUSED") return "changed";
      return isAmbiguousMutationError(error) ? "unknown" : "rejected";
    }
    if (!publish || current.publicationStatus === "published") {
      finishSavedCard(current);
      return "committed";
    }

    try {
      const published = await apiPostParsed<AdminCardDetail>(`/admin/cards/${current.id}/publish`, {
        expectedVersion: current.version,
      }, adminCardDetailSchema);
      finishSavedCard(published);
      return "committed";
    } catch (error) {
      if (!isAmbiguousMutationError(error)) {
        cacheSavedCard(current);
        return "rejected";
      }
      try {
        const afterPublish = await apiGetParsed<AdminCardDetail>(`/admin/cards/${current.id}`, adminCardDetailSchema);
        if (afterPublish.publicationStatus === "published") {
          finishSavedCard(afterPublish);
          return "committed";
        }
      } catch {
        return "unknown";
      }
      return "unknown";
    }
  }

  async function verifyPendingSave(): Promise<void> {
    if (!pendingSaveAttempt || isCheckingSave) return;
    setIsCheckingSave(true);
    setErrors({});
    try {
      const result = mode === "create"
        ? await verifyCreateMutation(pendingSaveAttempt.input, pendingSaveAttempt.action === "publish")
        : await verifyEditMutation(
          pendingSaveAttempt.cardId!,
          pendingSaveAttempt.input,
          pendingSaveAttempt.action === "publish",
        );
      if (result === "committed") {
        setPendingSaveAttempt(null);
        return;
      }
      if (result === "not_found") {
        setPendingSaveAttempt(null);
        setErrors({ form: "Попытка сохранения не найдена. Проверьте данные и повторите сохранение." });
        onRecoveryError?.("Попытка сохранения не найдена. Проверьте данные и повторите сохранение.");
        return;
      }
      if (result === "changed") {
        try {
          await onRecoveryRefresh?.();
          setPendingSaveAttempt(null);
          setErrors({ form: "Карточка изменилась. Данные обновлены, проверьте форму перед сохранением." });
        } catch {
          setErrors({ form: "Карточка изменилась, но обновить её не удалось. Повторите проверку." });
        }
        return;
      }
      if (result === "rejected") {
        setPendingSaveAttempt(null);
        setErrors({ form: "Сервер отклонил сохранение. Исправьте данные и повторите попытку." });
        return;
      }
      setErrors({ form: "Не удалось подтвердить результат сохранения. Форма остаётся заблокированной." });
    } finally {
      setIsCheckingSave(false);
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
        ? await apiPutParsed<AdminCardDetail>(`/admin/cards/${initial.id}`, { ...input, expectedVersion: initial.version }, adminCardDetailSchema)
        : await apiPostParsed<AdminCardDetail>("/admin/cards", input, adminCardDetailSchema);
      if (!publish) return saved;
      try {
        return await apiPostParsed<AdminCardDetail>(
          `/admin/cards/${saved.id}/publish`,
          { expectedVersion: saved.version },
          adminCardDetailSchema,
        );
      } catch (error) {
        throw new PublishAfterSaveError(saved, error);
      }
    },
    onSuccess: finishSavedCard,
    onSettled: () => setSaveAction(null),
  });

  const archiveMutation = useMutation({
    mutationFn: () => apiPostParsed<AdminCardDetail>(
      `/admin/cards/${initial!.id}/archive`,
      { expectedVersion: initial!.version },
      adminCardDetailSchema,
    ),
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
      qc.removeQueries({ queryKey: adminCatalogQueryKeys.card(initial!.id) });
      invalidateCatalogQueries(initial!.id);
      navigate({ href: "/admin/cards" });
    },
    onError: (error) => {
      setDeleteOpen(false);
      setErrors({ form: formatApiError(error, "Не удалось удалить карточку") });
      void reconcileCardMutation(initial!.id).then((result) => {
        if (result === "deleted") {
          qc.removeQueries({ queryKey: adminCatalogQueryKeys.card(initial!.id) });
          navigate({ href: "/admin/cards" });
        }
      });
    },
  });

  // Черновик — только для create, только когда есть что сохранять (пустая форма не пишется).
  const completedImages = imageUploads.images
    .filter((image) => image.status === "done")
    .map((image) => ({ storagePath: image.storagePath!, publicUrl: image.publicUrl! }));
  const draftSnapshot = JSON.stringify(toDraft(editor, createClientRequestId, completedImages));
  const debouncedSnapshot = useDebouncedValue(mode === "create" ? draftSnapshot : "", 500);

  useEffect(() => {
    if (mode !== "create" || !debouncedSnapshot) return;
    saveCardDraft(JSON.parse(debouncedSnapshot) as CardDraft);
  }, [debouncedSnapshot, mode]);

  function applyTypeChange(nextType: CatalogType) {
    setEditor((current) => changeEditorType(current, nextType));
    setTypeChange(null);
  }

  function handleTypeChange(nextType: CatalogType) {
    if (nextType === type) return;
    if (categoryId || territoryCode || ownershipForm || productLocation || commodityGroup || volumeTonnes || serviceTerritoryCodes.length > 0) {
      setTypeChange(nextType);
      return;
    }
    applyTypeChange(nextType);
  }

  function toggleServiceTerritory(code: TerritoryCode) {
    setEditor((current) => toggleEditorServiceTerritory(current, code));
  }

  function handleCategoryChange(nextCategoryId: string) {
    const nextCategory = categoriesQuery.data?.find((category) => category.id === nextCategoryId);
    setEditor((current) => changeEditorCategory(current, nextCategoryId, nextCategory?.isCommodity ?? false));
  }

  function buildPayload(completeSpecsOnly = false, mutationId?: string) {
    return {
      ...toMutationInput(editor, {
        clientRequestId: mode === "create" ? createClientRequestId : undefined,
        sortOrder: initial?.sortOrder ?? 0,
        categoryIsCommodity: selectedCategory?.isCommodity ?? false,
        images: completedImages,
        completeSpecsOnly,
      }),
      mutationId,
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
    categoryIsCommodity: selectedCategory?.isCommodity ?? false,
    commodityGroup: livePayload.commodityGroup,
    volumeTonnes: livePayload.volumeTonnes,
    serviceAllKazakhstan: livePayload.serviceAllKazakhstan,
    serviceTerritoryCount: livePayload.serviceAllKazakhstan ? 1 : livePayload.serviceTerritoryCodes.length,
    availability: livePayload.availability || null,
    imageCount: livePayload.images.length,
    imagePending: imageUploads.images.some((image) => image.status === "compressing" || image.status === "uploading"),
    imageError: imageUploads.hasErrors,
    specs: livePayload.specs,
  });

  async function handleAction(action: SaveAction) {
    if (pendingSaveAttempt) return;
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

    const input = mode === "edit"
      ? { ...parsed.data, mutationId: crypto.randomUUID() }
      : parsed.data;

    if (action === "publish") {
      if (imageUploads.hasErrors) {
        setErrors({ images: "Исправьте ошибку загрузки фото перед публикацией" });
        return;
      }
      if (livePublicationIssues.length > 0) {
        setErrors({ form: `Сначала исправьте: ${livePublicationIssues.join("; ")}` });
        return;
      }
    }

    try {
      setSaveAction(action);
      await saveMutation.mutateAsync({ input, publish: action === "publish" });
    } catch (error) {
      if (error instanceof PublishAfterSaveError) {
        if (isAmbiguousMutationError(error.publishError)) {
          const result = mode === "create"
            ? await verifyCreateMutation(input, true)
            : await verifyEditMutation(initial!.id, input, true);
          if (result === "committed") return;
          if (result === "rejected") {
            const message = formatApiError(error.publishError, "Не удалось опубликовать карточку");
            setErrors({ form: message });
            onRecoveryError?.(message);
            return;
          }
          setPendingSaveAttempt({ action, input, cardId: initial?.id });
          setErrors({
            form: `Не удалось подтвердить публикацию: ${formatApiError(error.publishError, "сервер не ответил")}. Форма заблокирована до повторной проверки.`,
          });
          return;
        }
        const current = await refreshSavedCard(error.saved);
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
      if (isAmbiguousMutationError(error)) {
        const result = mode === "create"
          ? await verifyCreateMutation(input, action === "publish")
          : await verifyEditMutation(initial!.id, input, action === "publish");
        if (result === "committed") return;
        if (result === "rejected" || result === "not_found") {
          const message = formatApiError(error, "Не удалось сохранить карточку");
          setErrors({ form: message });
          onRecoveryError?.(message);
          return;
        }
        setPendingSaveAttempt({ action, input, cardId: initial?.id });
        setErrors({
          form: `Не удалось подтвердить сохранение: ${formatApiError(error, "сервер не ответил")}. Форма заблокирована до повторной проверки.`,
        });
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

  const isSaveBlocked = pendingSaveAttempt !== null || isCheckingSave;
  const canSave = imageUploads.settled && !saveMutation.isPending && !isSaveBlocked;
  const canPublish = canSave && livePublicationIssues.length === 0;
  const previewCard = toPreview(editor, {
    initial,
    categoryIsCommodity: selectedCategory?.isCommodity ?? false,
    territories: territoriesQuery.data ?? [],
    images: completedImages,
  });

  return (
    <form className="form" onSubmit={handleSubmit} noValidate>
      {pendingSaveAttempt && (
        <div className="card notice-card" role="alert">
          <p className="eyebrow">Проверка сохранения</p>
          <p className="description">Результат сохранения не подтверждён. Форма заблокирована, чтобы не потерять исходную попытку.</p>
          <button type="button" className="button button-primary" onClick={() => void verifyPendingSave()} disabled={isCheckingSave}>
            {isCheckingSave ? "Проверяем…" : "Повторить проверку"}
          </button>
        </div>
      )}

      <fieldset disabled={isSaveBlocked}>
      <Segmented options={typeOptions} value={type} onChange={handleTypeChange} ariaLabel="Тип карточки" />

      <label className="field">
        <span className="field-label">Категория</span>
        <select
          className="input"
          data-testid="card-editor-category"
          value={categoryId}
          onChange={(e) => handleCategoryChange(e.target.value)}
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

      <Segmented
        options={type === "product" ? priceTypeOptions.filter((option) => option.value !== "on_request") : priceTypeOptions}
        value={priceType === "on_request" && type === "product" ? "fixed" : priceType}
        onChange={(next) => setPriceType(next)}
        ariaLabel="Тип цены"
      />

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
            <span className="field-label">Область</span>
            <select
              className="input"
              data-testid="card-editor-territory"
              value={territoryCode}
              onChange={(event) => setTerritoryCode(event.target.value as TerritoryCode | "")}
              disabled={territoriesQuery.isPending}
            >
              <option value="">Выберите регион</option>
              {(territoriesQuery.data ?? []).filter((territory) => territory.kind === "region").map((territory) => (
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
          {selectedCategory?.isCommodity && (
            <>
              <label className="field">
                <span className="field-label">Группа продукции</span>
                <select className="input" value={commodityGroup} onChange={(event) => setCommodityGroup(event.target.value as CommodityGroup | "")}>
                  <option value="">Выберите группу</option>
                  {Object.entries(commodityGroupLabels).map(([value, label]) => (
                    <option key={value} value={value}>{label}</option>
                  ))}
                </select>
                {errors.commodityGroup && <span className="field-error">{errors.commodityGroup}</span>}
              </label>
              <label className="field">
                <span className="field-label">Объём, тонн</span>
                <input
                  className="input"
                  value={volumeTonnes}
                  onChange={(event) => setVolumeTonnes(event.target.value.replace(/[^\d.,]/g, ""))}
                  inputMode="decimal"
                  placeholder="Например, 12,375"
                />
                {errors.volumeTonnes && <span className="field-error">{errors.volumeTonnes}</span>}
              </label>
            </>
          )}
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

      {type === "service" && (
        <label className="field">
          <span className="field-label">Срок исполнения</span>
          <input className="input" data-testid="card-editor-availability" value={availability} onChange={(event) => setAvailability(event.target.value)} />
          {errors.availability && <span className="field-error">{errors.availability}</span>}
        </label>
      )}

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
      </fieldset>
    </form>
  );
}
