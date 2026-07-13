import { BottomSheet } from "../BottomSheet";

interface ConfirmSheetProps {
  open: boolean;
  title: string;
  description?: string;
  confirmLabel: string;
  danger?: boolean;
  pending?: boolean;
  onConfirm: () => void;
  onClose: () => void;
}

/** Шторка подтверждения деструктивного действия (удаление карточки/категории). */
export function ConfirmSheet({
  open,
  title,
  description,
  confirmLabel,
  danger,
  pending,
  onConfirm,
  onClose
}: ConfirmSheetProps) {
  return (
    <BottomSheet open={open} onClose={onClose}>
      <div className="form">
        <h2 className="screen-title">{title}</h2>
        {description && <p className="description">{description}</p>}
        <div className="sheet-actions">
          <button
            type="button"
            className={`button ${danger ? "button-danger" : "button-primary"}`}
            data-testid="confirm-sheet-confirm"
            onClick={onConfirm}
            disabled={pending}
          >
            {pending ? "…" : confirmLabel}
          </button>
          <button type="button" className="button button-secondary" onClick={onClose} disabled={pending}>
            Отмена
          </button>
        </div>
      </div>
    </BottomSheet>
  );
}
