import {
  createRequestInput,
  REQUEST_COMMENT_MAX,
  type CatalogType,
  type CreateRequestInput
} from "@agromarket/contracts";
import { useMutation } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import { ApiError, apiPost } from "../lib/api";
import { useAuth } from "../lib/auth";
import { zodFieldErrors } from "../lib/formErrors";
import { BottomSheet } from "./BottomSheet";
import { ContactFields } from "./ContactFields";
import { SuccessCheck } from "./SuccessCheck";

export type RequestSource =
  | { source: "card"; cardId: string }
  | { source: "tab"; tabType: CatalogType }
  | { source: "profile" };

interface RequestSheetProps {
  open: boolean;
  onClose: () => void;
  source: RequestSource;
}

/** Шторка формы заявки — три источника (карточка/вкладка/профиль), общая для всего Этапа 6. */
export function RequestSheet({ open, onClose, source }: RequestSheetProps) {
  return (
    <BottomSheet open={open} onClose={onClose}>
      <RequestSheetContent source={source} onClose={onClose} />
    </BottomSheet>
  );
}

function RequestSheetContent({ source, onClose }: { source: RequestSource; onClose: () => void }) {
  const { profile, updateProfile } = useAuth();

  const [name, setName] = useState(profile?.contactName ?? "");
  const [phone, setPhone] = useState(profile?.contactPhone ?? "");
  const [comment, setComment] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [success, setSuccess] = useState(false);

  const mutation = useMutation({
    mutationFn: (input: CreateRequestInput) => apiPost("/requests", input)
  });

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setErrors({});

    const parsed = createRequestInput.safeParse({
      ...source,
      contactName: name,
      contactPhone: phone,
      comment
    });
    if (!parsed.success) {
      setErrors(zodFieldErrors(parsed.error));
      return;
    }

    try {
      await mutation.mutateAsync(parsed.data);
      setSuccess(true);
      // Правки имени/телефона в форме заявки автоматически обновляют профиль — best-effort,
      // заявка уже отправлена, ошибка синхронизации профиля не должна портить успех.
      if (profile && (profile.contactName !== parsed.data.contactName || profile.contactPhone !== parsed.data.contactPhone)) {
        updateProfile({ contactName: parsed.data.contactName, contactPhone: parsed.data.contactPhone }).catch(() => {});
      }
    } catch (error) {
      setErrors({ form: error instanceof ApiError ? error.message : "Не удалось отправить заявку" });
    }
  }

  if (success) {
    return (
      <div className="sheet-result">
        <SuccessCheck title="Заявка отправлена!" description="Мы свяжемся с вами по указанному телефону." />
        <button type="button" className="button button-primary" onClick={onClose}>
          Вернуться в каталог
        </button>
      </div>
    );
  }

  return (
    <form className="form" onSubmit={handleSubmit} noValidate>
      <h2 className="screen-title">Оставить заявку</h2>

      <ContactFields name={name} phone={phone} onNameChange={setName} onPhoneChange={setPhone} errors={errors} />

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

      {errors.form && <p className="field-error">{errors.form}</p>}

      <button type="submit" className="button button-primary" disabled={mutation.isPending}>
        {mutation.isPending ? "Отправляем…" : "Отправить заявку"}
      </button>
    </form>
  );
}
