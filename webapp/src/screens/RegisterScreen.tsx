import { registerInput } from "@agromarket/contracts";
import { useState } from "react";
import { useAuth } from "../lib/auth";
import { ApiError } from "../lib/api";
import { sharePhoneFromTelegram } from "../lib/shareContact";
import { isTelegramContext } from "../lib/telegram";

export function RegisterScreen() {
  const { profile, register, registerPending } = useAuth();

  const initialName =
    profile?.contactName ||
    [profile?.telegramFirstName, profile?.telegramLastName].filter(Boolean).join(" ");

  const [name, setName] = useState(initialName);
  const [phone, setPhone] = useState(profile?.contactPhone ?? "");
  const [errors, setErrors] = useState<{ name?: string; phone?: string; form?: string }>({});

  const inTelegram = isTelegramContext();

  async function handleShareContact() {
    const shared = await sharePhoneFromTelegram();
    if (shared) setPhone(shared);
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setErrors({});

    const parsed = registerInput.safeParse({ contactName: name, contactPhone: phone });
    if (!parsed.success) {
      const next: { name?: string; phone?: string } = {};
      for (const issue of parsed.error.issues) {
        if (issue.path[0] === "contactName") next.name = issue.message;
        if (issue.path[0] === "contactPhone") next.phone = issue.message;
      }
      setErrors(next);
      return;
    }

    try {
      await register(parsed.data);
    } catch (error) {
      setErrors({
        form: error instanceof ApiError ? error.message : "Не удалось сохранить данные"
      });
    }
  }

  return (
    <main className="shell">
      <section className="card">
        <p className="eyebrow">Регистрация</p>
        <h1>Давайте познакомимся</h1>
        <p className="description">
          Укажите имя и телефон — по ним с вами свяжутся по заявкам. Данные сохранятся в профиле.
        </p>

        <form className="form" onSubmit={handleSubmit} noValidate>
          <label className="field">
            <span className="field-label">Имя</span>
            <input
              className="input"
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={100}
              placeholder="Например, Айдос"
            />
            {errors.name && <span className="field-error">{errors.name}</span>}
          </label>

          <label className="field">
            <span className="field-label">Телефон</span>
            <input
              className="input"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              inputMode="tel"
              placeholder="+7 701 234 56 78"
            />
            {errors.phone && <span className="field-error">{errors.phone}</span>}
          </label>

          {inTelegram && (
            <button type="button" className="button button-secondary" onClick={handleShareContact}>
              Поделиться контактом
            </button>
          )}

          {errors.form && <p className="field-error">{errors.form}</p>}

          <button type="submit" className="button button-primary" disabled={registerPending}>
            {registerPending ? "Сохраняем…" : "Продолжить"}
          </button>
        </form>
      </section>
    </main>
  );
}
