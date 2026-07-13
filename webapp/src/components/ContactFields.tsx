import { NAME_MAX } from "@agromarket/contracts";
import { sharePhoneFromTelegram } from "../lib/shareContact";
import { isTelegramContext } from "../lib/telegram";

interface ContactFieldsProps {
  name: string;
  phone: string;
  onNameChange: (value: string) => void;
  onPhoneChange: (value: string) => void;
  errors: { contactName?: string; contactPhone?: string };
  showShare?: boolean;
}

/** Общие поля имя+телефон, переиспользуются в форме заявки, обратной связи и редактировании профиля. */
export function ContactFields({ name, phone, onNameChange, onPhoneChange, errors, showShare = true }: ContactFieldsProps) {
  const inTelegram = isTelegramContext();

  async function handleShareContact() {
    const shared = await sharePhoneFromTelegram();
    if (shared) onPhoneChange(shared.phone);
  }

  return (
    <>
      <label className="field">
        <span className="field-label">Имя</span>
        <input
          className="input"
          data-testid="request-name-input"
          value={name}
          onChange={(e) => onNameChange(e.target.value)}
          maxLength={NAME_MAX}
          placeholder="Например, Айдос"
        />
        {errors.contactName && <span className="field-error" role="alert">{errors.contactName}</span>}
      </label>

      <label className="field">
        <span className="field-label">Телефон</span>
        <input
          className="input"
          data-testid="request-phone-input"
          value={phone}
          onChange={(e) => onPhoneChange(e.target.value)}
          inputMode="tel"
          placeholder="+7 701 234 56 78"
        />
        {errors.contactPhone && <span className="field-error" role="alert">{errors.contactPhone}</span>}
      </label>

      {inTelegram && showShare && (
        <button type="button" className="button button-secondary" onClick={handleShareContact}>
          Поделиться контактом
        </button>
      )}
    </>
  );
}
