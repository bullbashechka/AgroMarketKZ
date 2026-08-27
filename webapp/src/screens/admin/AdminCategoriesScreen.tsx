import {
  CATEGORY_NAME_MAX,
  createCategoryInput,
  updateCategoryInput,
  type AdminCategory,
  type CatalogType,
} from "@agromarket/contracts";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate, useSearch } from "@tanstack/react-router";
import { useState, type FormEvent } from "react";
import { ConfirmSheet } from "../../components/admin/ConfirmSheet";
import { Segmented } from "../../components/admin/Segmented";
import { BottomSheet } from "../../components/BottomSheet";
import { ErrorState } from "../../components/ErrorState";
import { Screen } from "../../components/Screen";
import { SkeletonList } from "../../components/Skeleton";
import { ApiError, apiDelete, apiPatch, apiPost } from "../../lib/api";
import {
  adminCategoriesQueryOptions,
  invalidateCatalogAfterAdminCategoryMutation,
} from "../../lib/queries";
import type { AdminTypeSearch } from "../../lib/searchParams";

const typeOptions: { value: CatalogType; label: string }[] = [
  { value: "service", label: "Услуги" },
  { value: "product", label: "Товары" }
];

type Sheet =
  | { mode: "actions"; category: AdminCategory }
  | { mode: "commodity"; category: AdminCategory }
  | { mode: "rename"; category: AdminCategory }
  | { mode: "specs"; category: AdminCategory }
  | { mode: "create" }
  | { mode: "deleteBlocked"; category: AdminCategory }
  | { mode: "deleteConfirm"; category: AdminCategory }
  | null;

/** Категории по вкладкам типа: создание, переименование, удаление (с защитой от удаления непустых). */
export function AdminCategoriesScreen() {
  const search = useSearch({ strict: false }) as AdminTypeSearch;
  const navigate = useNavigate();
  const qc = useQueryClient();
  const type: CatalogType = search.type ?? "service";

  const { data, isPending, isError, refetch } = useQuery(adminCategoriesQueryOptions(type));
  const [sheet, setSheet] = useState<Sheet>(null);

  function handleTypeChange(nextType: CatalogType) {
    navigate({ href: `/admin/categories?type=${nextType}`, replace: true });
  }

  function invalidate() {
    invalidateCatalogAfterAdminCategoryMutation(qc);
  }

  const createMutation = useMutation({
    mutationFn: (name: string) => apiPost("/admin/categories", { type, name, sortOrder: data?.length ?? 0 }),
    onSuccess: () => {
      invalidate();
      setSheet(null);
    }
  });

  const renameMutation = useMutation({
    mutationFn: ({ id, name }: { id: string; name: string }) => apiPatch(`/admin/categories/${id}`, { name }),
    onSuccess: () => {
      invalidate();
      setSheet(null);
    }
  });

  const specsMutation = useMutation({
    mutationFn: ({ id, requiredSpecs }: { id: string; requiredSpecs: string[] }) =>
      apiPatch(`/admin/categories/${id}`, { requiredSpecs }),
    onSuccess: () => {
      invalidate();
      setSheet(null);
    },
  });

  const commodityMutation = useMutation({
    mutationFn: ({ id, isCommodity }: { id: string; isCommodity: boolean }) =>
      apiPatch(`/admin/categories/${id}`, { isCommodity }),
    onSuccess: () => {
      invalidate();
      setSheet(null);
    }
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => apiDelete(`/admin/categories/${id}`),
    onSuccess: () => {
      invalidate();
      setSheet(null);
    },
    onError: (error, id) => {
      if (error instanceof ApiError && error.status === 409) {
        const category = data?.find((c) => c.id === id);
        if (category) setSheet({ mode: "deleteBlocked", category });
      }
    }
  });

  return (
    <Screen back title="Категории" fallbackTo="/general">
      <Segmented options={typeOptions} value={type} onChange={handleTypeChange} ariaLabel="Тип категорий" />

      {isPending && <SkeletonList />}
      {isError && <ErrorState onRetry={refetch} />}
      {data && (
        <>
          {data.length === 0 ? (
            <div className="empty-state">
              <p>Категорий пока нет.</p>
            </div>
          ) : (
            <div className="list-rows">
              {data.map((category) => (
                <button
                  key={category.id}
                  type="button"
                  className="list-row category-row"
                  data-testid="admin-category-row"
                  data-category-id={category.id}
                  onClick={() => setSheet({ mode: "actions", category })}
                >
                  <span className="list-row-title">
                    {category.name}
                    {category.activeCardCount === 0 && (
                      <span className="badge badge--muted">Не видна пользователям — нет карточек</span>
                    )}
                  </span>
                  <span className="list-row-value">{category.cardCount}</span>
                  <span className="list-row-chevron" aria-hidden="true">
                    ›
                  </span>
                </button>
              ))}
            </div>
          )}

          <button
            type="button"
            className="button button-primary tab-cta"
            data-testid="admin-category-new"
            onClick={() => setSheet({ mode: "create" })}
          >
            + Добавить категорию
          </button>
        </>
      )}

      <BottomSheet open={sheet?.mode === "actions"} onClose={() => setSheet(null)}>
        {sheet?.mode === "actions" && (
          <div className="sheet-actions">
            <h2 className="screen-title">{sheet.category.name}</h2>
            <button
              type="button"
              className="sheet-action"
              onClick={() => setSheet({ mode: "rename", category: sheet.category })}
            >
              Переименовать
            </button>
            <button
              type="button"
              className="sheet-action"
              onClick={() => setSheet({ mode: "specs", category: sheet.category })}
            >
              Обязательные характеристики
            </button>
            {sheet.category.type === "product" && (
              <button
                type="button"
                className="sheet-action"
                onClick={() => setSheet({ mode: "commodity", category: sheet.category })}
              >
                {sheet.category.isCommodity ? "Снять признак товарной категории" : "Сделать товарной категорией"}
              </button>
            )}
            <button
              type="button"
              className="sheet-action"
              data-testid="admin-category-delete"
              onClick={() => {
                const category = sheet.category;
                setSheet(
                  category.cardCount > 0 ? { mode: "deleteBlocked", category } : { mode: "deleteConfirm", category }
                );
              }}
            >
              Удалить
            </button>
          </div>
        )}
      </BottomSheet>

      <BottomSheet open={sheet?.mode === "specs"} onClose={() => setSheet(null)}>
        {sheet?.mode === "specs" && (
          <RequiredSpecsForm
            category={sheet.category}
            pending={specsMutation.isPending}
            onSubmit={(requiredSpecs) => specsMutation.mutateAsync({ id: sheet.category.id, requiredSpecs })}
          />
        )}
      </BottomSheet>

      <BottomSheet open={sheet?.mode === "commodity"} onClose={() => setSheet(null)}>
        {sheet?.mode === "commodity" && (
          <CommodityCategoryForm
            category={sheet.category}
            pending={commodityMutation.isPending}
            onSubmit={(isCommodity) => commodityMutation.mutateAsync({ id: sheet.category.id, isCommodity })}
          />
        )}
      </BottomSheet>

      <BottomSheet open={sheet?.mode === "create" || sheet?.mode === "rename"} onClose={() => setSheet(null)}>
        {(sheet?.mode === "create" || sheet?.mode === "rename") && (
          <CategoryNameForm
            key={sheet.mode === "rename" ? sheet.category.id : "create"}
            initialName={sheet.mode === "rename" ? sheet.category.name : ""}
            pending={sheet.mode === "create" ? createMutation.isPending : renameMutation.isPending}
            onSubmit={async (name) => {
              if (sheet.mode === "create") await createMutation.mutateAsync(name);
              else await renameMutation.mutateAsync({ id: sheet.category.id, name });
            }}
          />
        )}
      </BottomSheet>

      <BottomSheet open={sheet?.mode === "deleteBlocked"} onClose={() => setSheet(null)}>
        {sheet?.mode === "deleteBlocked" && (
          <div className="form">
            <h2 className="screen-title">Нельзя удалить категорию</h2>
            <p className="description">
              В категории «{sheet.category.name}» {sheet.category.cardCount} карточек. Сначала перенесите или удалите
              их.
            </p>
            <div className="sheet-actions">
              <button
                type="button"
                className="button button-primary"
                onClick={() =>
                  navigate({ href: `/admin/cards?type=${type}&categoryId=${sheet.category.id}` })
                }
              >
                Показать карточки
              </button>
              <button type="button" className="button button-secondary" onClick={() => setSheet(null)}>
                Отмена
              </button>
            </div>
          </div>
        )}
      </BottomSheet>

      <ConfirmSheet
        open={sheet?.mode === "deleteConfirm"}
        title="Удалить категорию?"
        description={sheet?.mode === "deleteConfirm" ? `Категория «${sheet.category.name}» будет удалена.` : undefined}
        confirmLabel="Удалить"
        danger
        pending={deleteMutation.isPending}
        onConfirm={() => sheet?.mode === "deleteConfirm" && deleteMutation.mutate(sheet.category.id)}
        onClose={() => setSheet(null)}
      />
    </Screen>
  );
}

function RequiredSpecsForm({
  category,
  pending,
  onSubmit,
}: {
  category: AdminCategory;
  pending: boolean;
  onSubmit: (requiredSpecs: string[]) => Promise<unknown>;
}) {
  const [items, setItems] = useState(category.requiredSpecs);
  const [error, setError] = useState<string | undefined>();

  function move(index: number, direction: -1 | 1) {
    const target = index + direction;
    if (target < 0 || target >= items.length) return;
    const next = [...items];
    [next[index], next[target]] = [next[target]!, next[index]!];
    setItems(next);
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError(undefined);
    const parsed = updateCategoryInput.safeParse({ requiredSpecs: items });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message);
      return;
    }
    try {
      await onSubmit(parsed.data.requiredSpecs ?? []);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Не удалось сохранить характеристики");
    }
  }

  return (
    <form className="form" onSubmit={submit} noValidate>
      <h2 className="screen-title">Обязательные характеристики</h2>
      <p className="description">{category.name}. Порядок здесь станет порядком полей в карточке.</p>
      {items.map((item, index) => (
        <div className="spec-row" key={`${index}-${item}`}>
          <input
            className="input"
            data-testid="admin-required-spec-input"
            value={item}
            onChange={(event) => setItems(items.map((value, idx) => idx === index ? event.target.value : value))}
            placeholder="Например, Год выпуска"
          />
          <div className="inline-actions">
            <button type="button" className="button button-secondary" onClick={() => move(index, -1)} aria-label="Выше">↑</button>
            <button type="button" className="button button-secondary" onClick={() => move(index, 1)} aria-label="Ниже">↓</button>
            <button type="button" className="spec-row-remove" onClick={() => setItems(items.filter((_, idx) => idx !== index))} aria-label="Удалить">×</button>
          </div>
        </div>
      ))}
      <button type="button" className="button button-secondary" data-testid="admin-required-spec-add" onClick={() => setItems([...items, ""])}>
        + Добавить характеристику
      </button>
      {error && <p className="field-error" role="alert">{error}</p>}
      <button type="submit" className="button button-primary" data-testid="admin-required-spec-save" disabled={pending}>
        {pending ? "Сохраняем…" : "Сохранить"}
      </button>
    </form>
  );
}

function CategoryNameForm({
  initialName,
  pending,
  onSubmit
}: {
  initialName: string;
  pending: boolean;
  onSubmit: (name: string) => Promise<void>;
}) {
  const [name, setName] = useState(initialName);
  const [error, setError] = useState<string | undefined>();

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(undefined);

    const parsed = createCategoryInput.pick({ name: true }).safeParse({ name });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message);
      return;
    }

    try {
      await onSubmit(parsed.data.name);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Не удалось сохранить категорию");
    }
  }

  return (
    <form className="form" onSubmit={handleSubmit} noValidate>
      <h2 className="screen-title">{initialName ? "Переименовать категорию" : "Новая категория"}</h2>
      <label className="field">
        <span className="field-label">Название</span>
        <input
          className="input"
          data-testid="admin-category-name-input"
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={CATEGORY_NAME_MAX}
          autoFocus
        />
        {error && <span className="field-error">{error}</span>}
      </label>
      <button type="submit" className="button button-primary" data-testid="admin-category-save" disabled={pending}>
        {pending ? "Сохраняем…" : "Сохранить"}
      </button>
    </form>
  );
}

function CommodityCategoryForm({
  category,
  pending,
  onSubmit,
}: {
  category: AdminCategory;
  pending: boolean;
  onSubmit: (isCommodity: boolean) => Promise<unknown>;
}) {
  const [isCommodity, setIsCommodity] = useState(category.isCommodity);
  const [error, setError] = useState<string | undefined>();

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError(undefined);
    try {
      await onSubmit(isCommodity);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Не удалось изменить признак категории");
    }
  }

  return (
    <form className="form" onSubmit={submit}>
      <h2 className="screen-title">Группа продукции</h2>
      <p className="description">
        Для товарной категории продавец указывает группу и объём в тоннах. Изменить признак можно только после скрытия её опубликованных карточек.
      </p>
      <label className="check-row">
        <input type="checkbox" checked={isCommodity} onChange={(event) => setIsCommodity(event.target.checked)} />
        <span>Это зерновая, масличная или зернобобовая продукция</span>
      </label>
      {error && <p className="field-error" role="alert">{error}</p>}
      <button type="submit" className="button button-primary" disabled={pending}>
        {pending ? "Сохраняем…" : "Сохранить"}
      </button>
    </form>
  );
}
