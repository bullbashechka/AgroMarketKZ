import {
  catalogTypeLabels,
  createCardInput,
  DESCRIPTION_MAX,
  CARD_TITLE_MAX,
  priceTypeLabels,
  type CardDetail,
  type CatalogType,
  type PriceType
} from "@agromarket/contracts";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate, useParams, useSearch } from "@tanstack/react-router";
import { useEffect, useState, type FormEvent } from "react";
import { ConfirmSheet } from "../../components/admin/ConfirmSheet";
import { ImagePicker } from "../../components/admin/ImagePicker";
import { Segmented } from "../../components/admin/Segmented";
import { SpecsEditor, type SpecRow } from "../../components/admin/SpecsEditor";
import { ErrorState } from "../../components/ErrorState";
import { Screen } from "../../components/Screen";
import { SkeletonList } from "../../components/Skeleton";
import { ApiError, apiDelete, apiPost, apiPut } from "../../lib/api";
import { clearCardDraft, loadCardDraft, saveCardDraft, type CardDraft } from "../../lib/cardDraft";
import { zodFieldErrorsByPath } from "../../lib/formErrors";
import { adminCardQueryOptions, adminCategoriesQueryOptions } from "../../lib/queries";
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
  { value: "on_request", label: priceTypeLabels.on_request }
];

export function CardEditorScreen() {
  const { cardId } = useParams({ strict: false }) as { cardId?: string };
  return cardId ? <CardEditorEdit cardId={cardId} /> : <CardEditorCreate />;
}

function CardEditorEdit({ cardId }: { cardId: string }) {
  const { data, isPending, isError, refetch } = useQuery(adminCardQueryOptions(cardId));

  return (
    <Screen back title="Карточка" fallbackTo="/admin/cards">
      {isPending && <SkeletonList />}
      {isError && <ErrorState onRetry={refetch} />}
      {data && <CardEditorForm mode="edit" initial={data} />}
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
  initial?: CardDetail;
  initialType?: CatalogType;
  draft?: CardDraft;
}

function CardEditorForm({ mode, initial, initialType, draft }: CardEditorFormProps) {
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
  const [specs, setSpecs] = useState<SpecRow[]>(
    (initial?.specs ?? draft?.specs ?? []).map((s) => ({ localId: crypto.randomUUID(), key: s.key, value: s.value }))
  );
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [deleteOpen, setDeleteOpen] = useState(false);

  const initialImages: DraftImage[] =
    initial?.images.map((img) => ({ storagePath: img.storagePath, publicUrl: img.url })) ?? draft?.images ?? [];
  const imageUploads = useImageUploads(initialImages);

  const categoriesQuery = useQuery(adminCategoriesQueryOptions(type));

  function invalidateCatalogQueries(cardId?: string) {
    qc.invalidateQueries({ queryKey: ["admin-cards"] });
    qc.invalidateQueries({ queryKey: ["admin-categories"] });
    qc.invalidateQueries({ queryKey: ["cards"] });
    qc.invalidateQueries({ queryKey: ["categories"] });
    if (cardId) qc.invalidateQueries({ queryKey: ["card", cardId] });
  }

  const saveMutation = useMutation({
    mutationFn: (input: ReturnType<typeof createCardInput.parse>) =>
      mode === "edit" && initial
        ? apiPut<CardDetail>(`/admin/cards/${initial.id}`, input)
        : apiPost<CardDetail>("/admin/cards", input),
    onSuccess: (card) => {
      qc.setQueryData(adminCardQueryOptions(card.id).queryKey, card);
      invalidateCatalogQueries(card.id);
      if (mode === "create") clearCardDraft();
      hapticNotify("success");
      navigate({ href: "/admin/cards" });
    }
  });

  const archiveMutation = useMutation({
    mutationFn: () =>
      apiPost<CardDetail>(`/admin/cards/${initial!.id}/${initial!.archivedAt ? "unarchive" : "archive"}`),
    onSuccess: (card) => {
      qc.setQueryData(adminCardQueryOptions(card.id).queryKey, card);
      invalidateCatalogQueries(card.id);
    }
  });

  const deleteMutation = useMutation({
    mutationFn: () => apiDelete(`/admin/cards/${initial!.id}`),
    onSuccess: () => {
      qc.removeQueries({ queryKey: ["admin-card", initial!.id] });
      invalidateCatalogQueries();
      navigate({ href: "/admin/cards" });
    }
  });

  // Черновик — только для create, только когда есть что сохранять (пустая форма не пишется).
  const draftSnapshot = JSON.stringify({
    type,
    categoryId,
    title,
    description,
    priceType,
    priceAmount,
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

  function handleTypeChange(nextType: CatalogType) {
    setType(nextType);
    setCategoryId("");
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setErrors({});

    const payload = {
      type,
      categoryId,
      title,
      description,
      sortOrder: initial?.sortOrder ?? 0,
      priceType,
      priceAmount: priceType === "fixed" ? Number(priceAmount) : null,
      images: imageUploads.images.map((img, idx) => ({ storagePath: img.storagePath!, sortOrder: idx })),
      specs: specs.map((s, idx) => ({ key: s.key, value: s.value, sortOrder: idx }))
    };

    const parsed = createCardInput.safeParse(payload);
    if (!parsed.success) {
      setErrors(zodFieldErrorsByPath(parsed.error));
      return;
    }

    try {
      await saveMutation.mutateAsync(parsed.data);
    } catch (error) {
      setErrors({ form: error instanceof ApiError ? error.message : "Не удалось сохранить карточку" });
    }
  }

  const canSave = imageUploads.ready && !saveMutation.isPending;

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
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          maxLength={DESCRIPTION_MAX}
          rows={4}
        />
        {errors.description && <span className="field-error">{errors.description}</span>}
      </label>

      <Segmented options={priceTypeOptions} value={priceType} onChange={setPriceType} ariaLabel="Тип цены" />

      {priceType === "fixed" && (
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

      <ImagePicker
        images={imageUploads.images}
        onAdd={imageUploads.addFiles}
        onRemove={imageUploads.remove}
        onMakeCover={imageUploads.makeCover}
        onRetry={imageUploads.retry}
        error={errors.images}
      />

      <SpecsEditor specs={specs} onChange={setSpecs} errors={errors} />

      {errors.form && <p className="field-error">{errors.form}</p>}

      <button type="submit" className="button button-primary" data-testid="card-editor-save" disabled={!canSave}>
        {saveMutation.isPending ? "Сохраняем…" : "Сохранить"}
      </button>

      {mode === "edit" && initial && (
        <>
          <button type="button" className="button button-secondary" onClick={() => archiveMutation.mutate()} disabled={archiveMutation.isPending}>
            {initial.archivedAt ? "Показать пользователям" : "Скрыть от пользователей"}
          </button>
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
    </form>
  );
}
