import { NAME_MAX } from "@agromarket/contracts";
import { isTelegramContext, requestContactPhone } from "../lib/telegram";

interface ContactFieldsProps {
  name: string;
  phone: string;
  onNameChange: (value: string) => void;
  onPhoneChange: (value: string) => void;
  errors: { contactName?: string; contactPhone?: string };
}

/** Общие поля имя+телефон, переиспользуются в форме заявки, обратной связи и редактировании профиля. */
export function ContactFields({ name, phone, onNameChange, onPhoneChange, errors }: ContactFieldsProps) {
  const inTelegram = isTelegramContext();

  async function handleShareContact() {
    const shared = await requestContactPhone();
    if (shared) onPhoneChange(shared);
  }

  return (
    <>
      <label className="field">
        <span className="field-label">Имя</span>
        <input
          className="input"
          value={name}
          onChange={(e) => onNameChange(e.target.value)}
          maxLength={NAME_MAX}
          placeholder="Например, Айдос"
        />
        {errors.contactName && <span className="field-error">{errors.contactName}</span>}
      </label>

      <label className="field">
        <span className="field-label">Телефон</span>
        <input
          className="input"
          value={phone}
          onChange={(e) => onPhoneChange(e.target.value)}
          inputMode="tel"
          placeholder="+7 701 234 56 78"
        />
        {errors.contactPhone && <span className="field-error">{errors.contactPhone}</span>}
      </label>

      {inTelegram && (
        <button type="button" className="button button-secondary" onClick={handleShareContact}>
          Поделиться контактом
        </button>
      )}
    </>
  );
}
