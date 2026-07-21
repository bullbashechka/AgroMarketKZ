import { registerInput } from "@agromarket/contracts";
import { useState, type FormEvent } from "react";
import { ApiError } from "../lib/api";
import { useAuth } from "../lib/auth";
import { zodFieldErrors } from "../lib/formErrors";
import { sharePhoneFromTelegram } from "../lib/shareContact";
import { isTelegramContext } from "../lib/telegram";
import { BottomSheet } from "./BottomSheet";

interface RegistrationSheetProps {
  open: boolean;
  onClose: () => void;
  onRegistered: () => void;
  reason?: string;
}

export function RegistrationSheet({ open, onClose, onRegistered, reason }: RegistrationSheetProps) {
  return (
    <BottomSheet open={open} onClose={onClose}>
      <RegistrationForm onRegistered={onRegistered} reason={reason} />
    </BottomSheet>
  );
}

function RegistrationForm({ onRegistered, reason }: { onRegistered: () => void; reason?: string }) {
  const { profile, register, registerPending } = useAuth();
  const initialName = profile?.contactName
    || [profile?.telegramFirstName, profile?.telegramLastName].filter(Boolean).join(" ");
  const [name, setName] = useState(initialName);
  const [phone, setPhone] = useState(profile?.contactPhone ?? "");
  const [contactResponse, setContactResponse] = useState<string | undefined>();
  const [sharing, setSharing] = useState(false);
  const [hint, setHint] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});

  async function handleShareContact() {
    setSharing(true);
    setHint(null);
    const shared = await sharePhoneFromTelegram();
    setSharing(false);
    if (!shared) {
      setHint("Можно ввести номер вручную.");
      return;
    }
    setPhone(shared.phone);
    setContactResponse(shared.contactResponse);
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setErrors({});
    const parsed = registerInput.safeParse({
      contactName: name,
      contactPhone: phone,
      contactResponse,
    });
    if (!parsed.success) {
      setErrors(zodFieldErrors(parsed.error));
      return;
    }
    try {
      await register(parsed.data);
      onRegistered();
    } catch (error) {
      setErrors({ form: error instanceof ApiError ? error.message : "Не удалось сохранить данные" });
    }
  }

  return (
    <form className="form" onSubmit={handleSubmit} noValidate>
      <h2 className="screen-title">Найдите нужное — мы поможем связаться</h2>
      <p className="description">
        {reason ?? "Укажите имя и телефон один раз."} Используем их для обработки заявок.
        Контакты можно изменить в профиле.
      </p>
      <p className="muted">После этого станут доступны заявки, избранное и связь с менеджером.</p>

      <label className="field">
        <span className="field-label">Имя</span>
        <input
          className="input"
          data-testid="register-name-input"
          value={name}
          onChange={(event) => setName(event.target.value)}
          maxLength={100}
          autoFocus
        />
        {errors.contactName && <span className="field-error">{errors.contactName}</span>}
      </label>

      <label className="field">
        <span className="field-label">Телефон</span>
        <input
          className="input"
          data-testid="register-phone-input"
          value={phone}
          onChange={(event) => {
            setPhone(event.target.value);
            setContactResponse(undefined);
          }}
          inputMode="tel"
          placeholder="+7 701 234 56 78"
        />
        <span className="muted">Любой номер в международном формате, например +998 90 123 45 67</span>
        {errors.contactPhone && <span className="field-error">{errors.contactPhone}</span>}
      </label>

      {isTelegramContext() && (
        <button
          type="button"
          className="button button-secondary"
          data-testid="register-share-contact"
          onClick={handleShareContact}
          disabled={sharing || registerPending}
        >
          {sharing ? "Получаем номер…" : "Поделиться номером из Telegram"}
        </button>
      )}
      {hint && <p className="muted" role="status">{hint}</p>}
      {errors.form && <p className="field-error" role="alert">{errors.form}</p>}

      <button
        type="submit"
        className="button button-primary"
        data-testid="register-submit"
        disabled={sharing || registerPending}
      >
        {registerPending ? "Сохраняем…" : "Продолжить"}
      </button>
    </form>
  );
}
