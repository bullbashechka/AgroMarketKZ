import { updateSettingsInput, type AdminPlatformSettings } from "@agromarket/contracts";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import { ErrorState } from "../../components/ErrorState";
import { Screen } from "../../components/Screen";
import { SkeletonList } from "../../components/Skeleton";
import { SuccessCheck } from "../../components/SuccessCheck";
import { ApiError, apiPatch } from "../../lib/api";
import { zodFieldErrors } from "../../lib/formErrors";
import { adminSettingsQueryOptions } from "../../lib/queries";

export function AdminSettingsScreen() {
  const { data, isPending, isError, refetch } = useQuery(adminSettingsQueryOptions);

  return (
    <Screen back title="Контакты площадки" fallbackTo="/general">
      {isPending && <SkeletonList />}
      {isError && <ErrorState onRetry={refetch} />}
      {data && <AdminSettingsForm initial={data} />}
    </Screen>
  );
}

function AdminSettingsForm({ initial }: { initial: AdminPlatformSettings }) {
  const qc = useQueryClient();

  const [contactPhone, setContactPhone] = useState(initial.contactPhone ?? "");
  const [whatsappPhone, setWhatsappPhone] = useState(initial.whatsappPhone ?? "");
  const [telegramContact, setTelegramContact] = useState(initial.telegramContact ?? "");
  const [email, setEmail] = useState(initial.email ?? "");
  const [adminChatId, setAdminChatId] = useState(initial.adminChatId ?? "");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [success, setSuccess] = useState(false);

  const mutation = useMutation({
    mutationFn: (input: ReturnType<typeof updateSettingsInput.parse>) =>
      apiPatch<AdminPlatformSettings>("/admin/settings", input),
    onSuccess: (settings) => {
      qc.setQueryData(adminSettingsQueryOptions.queryKey, settings);
      qc.invalidateQueries({ queryKey: ["settings"] });
    }
  });

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setErrors({});
    setSuccess(false);

    const parsed = updateSettingsInput.safeParse({
      contactPhone: contactPhone.trim() ? contactPhone : null,
      whatsappPhone: whatsappPhone.trim() ? whatsappPhone : null,
      telegramContact: telegramContact.trim() ? telegramContact : null,
      email: email.trim() ? email : null,
      adminChatId: adminChatId.trim() ? adminChatId : null
    });
    if (!parsed.success) {
      setErrors(zodFieldErrors(parsed.error));
      return;
    }

    try {
      await mutation.mutateAsync(parsed.data);
      setSuccess(true);
    } catch (error) {
      setErrors({ form: error instanceof ApiError ? error.message : "Не удалось сохранить настройки" });
    }
  }

  if (success) {
    return (
      <>
        <SuccessCheck title="Настройки сохранены" />
        <button type="button" className="button button-primary" onClick={() => setSuccess(false)}>
          Продолжить редактирование
        </button>
      </>
    );
  }

  return (
    <form className="form" onSubmit={handleSubmit} noValidate>
      <label className="field">
        <span className="field-label">Телефон для связи</span>
        <input
          className="input"
          value={contactPhone}
          onChange={(e) => setContactPhone(e.target.value)}
          inputMode="tel"
          placeholder="+7 701 234 56 78"
        />
        <span className="muted">Любой номер в международном формате, например +998 90 123 45 67</span>
        {errors.contactPhone && <span className="field-error">{errors.contactPhone}</span>}
      </label>

      <label className="field">
        <span className="field-label">WhatsApp</span>
        <input
          className="input"
          value={whatsappPhone}
          onChange={(e) => setWhatsappPhone(e.target.value)}
          inputMode="tel"
          placeholder="+7 701 234 56 78"
        />
        <span className="muted">Любой номер в международном формате, например +998 90 123 45 67</span>
        {errors.whatsappPhone && <span className="field-error">{errors.whatsappPhone}</span>}
      </label>

      <label className="field">
        <span className="field-label">Telegram</span>
        <input
          className="input"
          value={telegramContact}
          onChange={(e) => setTelegramContact(e.target.value)}
          placeholder="@agromarketkz"
        />
        {errors.telegramContact && <span className="field-error">{errors.telegramContact}</span>}
      </label>

      <label className="field">
        <span className="field-label">Email</span>
        <input
          className="input"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          type="email"
          placeholder="info@agromarket.kz"
        />
        {errors.email && <span className="field-error">{errors.email}</span>}
      </label>

      <label className="field">
        <span className="field-label">Chat ID для уведомлений о заявках</span>
        <input
          className="input"
          value={adminChatId}
          onChange={(e) => setAdminChatId(e.target.value)}
          placeholder="-1001234567890"
        />
        {errors.adminChatId && <span className="field-error">{errors.adminChatId}</span>}
      </label>

      {errors.form && <p className="field-error">{errors.form}</p>}

      <button type="submit" className="button button-primary" disabled={mutation.isPending}>
        {mutation.isPending ? "Сохраняем…" : "Сохранить"}
      </button>
    </form>
  );
}
