import { useAuth } from "../lib/auth";

/** Вкладка «Общее»: сейчас — сводка профиля. Редактирование, избранное, обратная связь — Этап 6. */
export function GeneralTab() {
  const { profile } = useAuth();
  if (!profile) return null;

  return (
    <div className="screen">
      <div className="screen-header">
        <h2 className="screen-title">Общее</h2>
      </div>

      <section className="card">
        <p className="eyebrow">Профиль</p>
        <h1>Добро пожаловать{profile.contactName ? `, ${profile.contactName}` : ""}!</h1>
        <p className="description">
          Редактирование контактов, избранное и обратная связь появятся на Этапе 6.
        </p>

        <dl className="status-list">
          <div>
            <dt>Имя</dt>
            <dd>{profile.contactName ?? "—"}</dd>
          </div>
          <div>
            <dt>Телефон</dt>
            <dd>{profile.contactPhone ?? "—"}</dd>
          </div>
          <div>
            <dt>Роль</dt>
            <dd className={profile.isAdmin ? "ok" : "muted"}>
              {profile.isAdmin ? "администратор" : "пользователь"}
            </dd>
          </div>
        </dl>
      </section>
    </div>
  );
}
