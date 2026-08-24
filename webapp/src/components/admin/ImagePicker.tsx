import { MAX_IMAGES } from "@agromarket/contracts";
import { useRef, useState, type ChangeEvent } from "react";
import type { EditorImage } from "../../lib/useImageUploads";
import { BottomSheet } from "../BottomSheet";

interface ImagePickerProps {
  images: EditorImage[];
  onAdd: (files: FileList) => void;
  onRemove: (localId: string) => void;
  onMakeCover: (localId: string) => void;
  onRetry: (localId: string) => void;
  error?: string;
}

/**
 * Грид миниатюр фото карточки. Порядок не редактируется — только выбор обложки
 * (первый элемент). Тап по готовому/ошибочному фото открывает шторку действий.
 */
export function ImagePicker({ images, onAdd, onRemove, onMakeCover, onRetry, error }: ImagePickerProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const activeIndex = images.findIndex((img) => img.localId === activeId);
  const active = activeIndex >= 0 ? images[activeIndex] : undefined;
  const uploadPending = images.some((image) => image.status === "compressing" || image.status === "uploading");
  const uploadReady = images.length > 0 && images.every((image) => image.status === "done");
  const uploadError = images.some((image) => image.status === "error");

  function handleFiles(event: ChangeEvent<HTMLInputElement>) {
    if (event.target.files && event.target.files.length > 0) onAdd(event.target.files);
    event.target.value = "";
  }

  function handleThumbClick(img: EditorImage) {
    if (img.status === "compressing" || img.status === "uploading") return;
    setActiveId(img.localId);
  }

  return (
    <div className="field">
      <span className="field-label">Фото</span>
      <div className="thumb-grid">
        {images.map((img, idx) => (
          <button
            key={img.localId}
            type="button"
            className={`thumb${img.status === "error" ? " thumb--error" : ""}`}
            onClick={() => handleThumbClick(img)}
          >
            <img src={img.previewUrl} alt="" />
            {idx === 0 && img.status === "done" && <span className="thumb-cover">Обложка</span>}
            {(img.status === "compressing" || img.status === "uploading") && (
              <span className="thumb-overlay">
                <span className="thumb-spinner" />
              </span>
            )}
            {img.status === "error" && <span className="thumb-overlay thumb-overlay--error">Не удалось</span>}
          </button>
        ))}
        {images.length < MAX_IMAGES && (
          <button type="button" className="thumb thumb-add" onClick={() => inputRef.current?.click()} aria-label="Добавить фото">
            +
          </button>
        )}
      </div>
      <input ref={inputRef} type="file" accept="image/*" multiple hidden onChange={handleFiles} />
      {(uploadPending || uploadReady || uploadError) && (
        <p className="muted" role="status" aria-live="polite" data-testid="card-image-upload-status">
          {uploadPending
            ? "Фото загружается — публикация станет доступна после завершения."
            : uploadError
              ? "Некоторые фото не загрузились — повторите загрузку или удалите их."
              : "Фото готово к публикации."}
        </p>
      )}
      {error && <span className="field-error">{error}</span>}

      <BottomSheet open={active !== undefined} onClose={() => setActiveId(null)}>
        {active && (
          <div className="sheet-actions">
            {active.status === "error" && (
              <button
                type="button"
                className="sheet-action"
                onClick={() => {
                  onRetry(active.localId);
                  setActiveId(null);
                }}
              >
                Повторить
              </button>
            )}
            {active.status === "done" && activeIndex > 0 && (
              <button
                type="button"
                className="sheet-action"
                onClick={() => {
                  onMakeCover(active.localId);
                  setActiveId(null);
                }}
              >
                Сделать обложкой
              </button>
            )}
            <button
              type="button"
              className="sheet-action"
              onClick={() => {
                onRemove(active.localId);
                setActiveId(null);
              }}
            >
              Удалить
            </button>
          </div>
        )}
      </BottomSheet>
    </div>
  );
}
