import { useNavigate } from "@tanstack/react-router";
import { useState, type MouseEvent } from "react";
import { RequestSheet } from "../components/RequestSheet";
import { useAuth } from "../lib/auth";

function ListRow({ href, title, value }: { href: string; title: string; value?: string }) {
  const navigate = useNavigate();

  function handleClick(event: MouseEvent<HTMLAnchorElement>) {
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return;
    event.preventDefault();
    navigate({ href });
  }

  return (
    <a href={href} className="list-row" onClick={handleClick}>
      <span className="list-row-title">{title}</span>
      {value && <span className="list-row-value">{value}</span>}
      <span className="list-row-chevron" aria-hidden="true">
        ›
      </span>
    </a>
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

      <button type="button" className="button button-primary tab-cta" onClick={() => setRequestOpen(true)}>
        Оставить заявку
      </button>

      <RequestSheet open={requestOpen} onClose={() => setRequestOpen(false)} source={{ source: "profile" }} />
    </div>
  );
}
