import { updateProfileInput } from "@agromarket/contracts";
import { useNavigate } from "@tanstack/react-router";
import { useState, type FormEvent } from "react";
import { ContactFields } from "../components/ContactFields";
import { Screen } from "../components/Screen";
import { SuccessCheck } from "../components/SuccessCheck";
import { ApiError, apiDelete } from "../lib/api";
import { useAuth } from "../lib/auth";
import { zodFieldErrors } from "../lib/formErrors";
import { useRegistrationIntent } from "../lib/registrationIntent";

export function ProfileEditScreen() {
  const { profile, updateProfile, updateProfilePending } = useAuth();
  const { requireRegistration } = useRegistrationIntent();
  const navigate = useNavigate();

  const [name, setName] = useState(profile?.contactName ?? "");
  const [phone, setPhone] = useState(profile?.contactPhone ?? "");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [success, setSuccess] = useState(false);
  const [deleting, setDeleting] = useState(false);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setErrors({});

    const parsed = updateProfileInput.safeParse({ contactName: name, contactPhone: phone });
    if (!parsed.success) {
      setErrors(zodFieldErrors(parsed.error));
      return;
    }

    try {
      await updateProfile(parsed.data);
      setSuccess(true);
    } catch (error) {
      setErrors({ form: error instanceof ApiError ? error.message : "Не удалось сохранить данные" });
    }
  }

  async function handleDeleteAccount() {
    if (!window.confirm("Удалить аккаунт и обезличить историю обращений? Это действие нельзя отменить.")) return;
    setDeleting(true);
    try {
      await apiDelete("/profile", { confirmed: true });
      await navigate({ href: "/general" });
      window.location.reload();
    } catch (error) {
      setErrors({ form: error instanceof ApiError ? error.message : "Не удалось удалить аккаунт" });
      setDeleting(false);
    }
  }

  if (!profile?.isRegistered) {
    return (
      <Screen back title="Мои контакты" fallbackTo="/general">
        <div className="empty-state">
          <p>Укажите контакты, чтобы сохранить их в профиле.</p>
          <button
            type="button"
            className="button button-primary"
            onClick={() => requireRegistration(() => {}, "Укажите контакты, чтобы сохранить их в профиле.")}
          >
            Указать контакты
          </button>
        </div>
      </Screen>
    );
  }

  if (success) {
    return (
      <Screen back fallbackTo="/general">
        <SuccessCheck title="Контакты сохранены" />
        <button type="button" className="button button-primary" onClick={() => navigate({ href: "/general" })}>
          Назад
        </button>
      </Screen>
    );
  }

  return (
    <Screen back title="Мои контакты" fallbackTo="/general">
      <form className="form" onSubmit={handleSubmit} noValidate>
        <ContactFields name={name} phone={phone} onNameChange={setName} onPhoneChange={setPhone} errors={errors} />

        {errors.form && <p className="field-error">{errors.form}</p>}

        <button type="submit" className="button button-primary" disabled={updateProfilePending}>
          {updateProfilePending ? "Сохраняем…" : "Сохранить"}
        </button>
        <button type="button" className="button button-secondary" onClick={handleDeleteAccount} disabled={deleting}>
          {deleting ? "Удаляем…" : "Удалить аккаунт"}
        </button>
      </form>
    </Screen>
  );
}
