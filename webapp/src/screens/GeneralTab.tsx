import { useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useState, type MouseEvent, type ReactNode } from "react";
import { RequestSheet } from "../components/RequestSheet";
import { useAuth } from "../lib/auth";
import { adminNewRequestsBadgeQueryOptions } from "../lib/queries";

function ListRow({ href, title, value, badge }: { href: string; title: string; value?: string; badge?: ReactNode }) {
  const navigate = useNavigate();

  function handleClick(event: MouseEvent<HTMLAnchorElement>) {
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return;
    event.preventDefault();
    navigate({ href });
  }

  return (
    <a href={href} className="list-row" data-testid={`general-link-${href}`} onClick={handleClick}>
      <span className="list-row-title">{title}</span>
      {badge}
      {value && <span className="list-row-value">{value}</span>}
      <span className="list-row-chevron" aria-hidden="true">
        ›
      </span>
    </a>
  );
}

/** Блок «Управление» — только для админов; бейдж новых заявок берёт первую страницу (без count-эндпоинта). */
function AdminSection() {
  const badge = useQuery({ ...adminNewRequestsBadgeQueryOptions, enabled: true });
  const count = badge.data ? (badge.data.hasMore ? `${badge.data.count}+` : String(badge.data.count)) : null;

  return (
    <>
      <p className="eyebrow admin-section-title">Управление</p>
      <div className="list-rows">
        <ListRow href="/admin/cards" title="Карточки" />
        <ListRow href="/admin/categories" title="Категории" />
        <ListRow
          href="/admin/requests"
          title="Заявки"
          badge={count && count !== "0" ? <span className="list-row-badge">{count}</span> : undefined}
        />
        <ListRow href="/admin/users" title="Пользователи" />
        <ListRow href="/admin/settings" title="Контакты площадки" />
      </div>
    </>
  );
}

/** Вкладка «Общее»: мои контакты, избранное, обратная связь, оставить заявку. */
export function GeneralTab() {
  const { profile } = useAuth();
  const [requestOpen, setRequestOpen] = useState(false);

  if (!profile) return null;

  return (
    <div className="screen">
      <div className="screen-header">
        <h2 className="screen-title">Общее</h2>
      </div>

      <section className="card">
        <p className="eyebrow">Профиль</p>
        <h1>Добро пожаловать{profile.contactName ? `, ${profile.contactName}` : ""}!</h1>
      </section>

      <div className="list-rows">
        <ListRow href="/general/contacts" title="Мои контакты" value={profile.contactName ?? "—"} />
        <ListRow href="/general/favorites" title="Избранное" />
        <ListRow href="/general/feedback" title="Обратная связь" />
      </div>

      <button
        type="button"
        className="button button-primary tab-cta"
        data-testid="tab-request-cta"
        onClick={() => setRequestOpen(true)}
      >
        Оставить заявку
      </button>

      {profile.isAdmin && <AdminSection />}

      <RequestSheet open={requestOpen} onClose={() => setRequestOpen(false)} source={{ source: "profile" }} />
    </div>
  );
}
