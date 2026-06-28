import type { Profile } from "@agromarket/contracts";

/** Временная заглушка главного меню. Реальные вкладки и каталог — Этап 5/6. */
export function HomePlaceholder({ profile }: { profile: Profile }) {
  return (
    <main className="shell">
      <section className="card">
        <p className="eyebrow">Главное меню</p>
        <h1>Добро пожаловать{profile.contactName ? `, ${profile.contactName}` : ""}!</h1>
        <p className="description">
          Вы вошли и зарегистрированы. Каталог «Услуги/Товары/Общее» появится на следующем этапе.
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
    </main>
  );
}
