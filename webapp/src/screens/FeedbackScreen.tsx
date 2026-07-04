import { createFeedbackInput, FEEDBACK_MESSAGE_MAX } from "@agromarket/contracts";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import { ContactFields } from "../components/ContactFields";
import { Screen } from "../components/Screen";
import { SuccessCheck } from "../components/SuccessCheck";
import { ApiError, apiPost } from "../lib/api";
import { useAuth } from "../lib/auth";
import { zodFieldErrors } from "../lib/formErrors";
import { telegramLink, whatsappLink } from "../lib/format";
import { settingsQueryOptions } from "../lib/queries";
import { openExternalLink, openTelegramDeepLink } from "../lib/telegram";

export function FeedbackScreen() {
  const { profile } = useAuth();
  const settingsQuery = useQuery(settingsQueryOptions);
  const settings = settingsQuery.data;

  const [name, setName] = useState(profile?.contactName ?? "");
  const [phone, setPhone] = useState(profile?.contactPhone ?? "");
  const [message, setMessage] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [success, setSuccess] = useState(false);

  const mutation = useMutation({
    mutationFn: (input: ReturnType<typeof createFeedbackInput.parse>) => apiPost("/feedback", input)
  });

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setErrors({});

    const parsed = createFeedbackInput.safeParse({ contactName: name, contactPhone: phone, message });
    if (!parsed.success) {
      setErrors(zodFieldErrors(parsed.error));
      return;
    }

    try {
      await mutation.mutateAsync(parsed.data);
      setSuccess(true);
    } catch (error) {
      setErrors({ form: error instanceof ApiError ? error.message : "Не удалось отправить сообщение" });
    }
  }

  const hasContacts = settings && (settings.contactPhone || settings.whatsappPhone || settings.telegramContact || settings.email);

  return (
    <Screen back title="Обратная связь" fallbackTo="/general">
      {hasContacts && (
        <div className="list-rows">
          {settings.contactPhone && (
            <a className="list-row" href={`tel:${settings.contactPhone}`}>
              <span className="list-row-title">Телефон</span>
              <span className="list-row-value">{settings.contactPhone}</span>
            </a>
          )}
          {settings.whatsappPhone && (
            <button
              type="button"
              className="list-row"
              onClick={() => openExternalLink(whatsappLink(settings.whatsappPhone!))}
            >
              <span className="list-row-title">WhatsApp</span>
              <span className="list-row-value">{settings.whatsappPhone}</span>
            </button>
          )}
          {settings.telegramContact && (
            <button
              type="button"
              className="list-row"
              onClick={() => openTelegramDeepLink(telegramLink(settings.telegramContact!))}
            >
              <span className="list-row-title">Telegram</span>
              <span className="list-row-value">{settings.telegramContact}</span>
            </button>
          )}
          {settings.email && (
            <a className="list-row" href={`mailto:${settings.email}`}>
              <span className="list-row-title">Email</span>
              <span className="list-row-value">{settings.email}</span>
            </a>
          )}
        </div>
      )}

      {success ? (
        <SuccessCheck title="Сообщение отправлено" description="Спасибо, мы скоро ответим." />
      ) : (
        <form className="form" onSubmit={handleSubmit} noValidate>
          <ContactFields name={name} phone={phone} onNameChange={setName} onPhoneChange={setPhone} errors={errors} />

          <label className="field">
            <span className="field-label">Сообщение</span>
            <textarea
              className="input input--textarea"
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              maxLength={FEEDBACK_MESSAGE_MAX}
              rows={4}
              placeholder="Расскажите, что случилось или что предложить"
            />
            {errors.message && <span className="field-error">{errors.message}</span>}
          </label>

          {errors.form && <p className="field-error">{errors.form}</p>}

          <button type="submit" className="button button-primary" disabled={mutation.isPending}>
            {mutation.isPending ? "Отправляем…" : "Отправить"}
          </button>
        </form>
      )}
    </Screen>
  );
}
