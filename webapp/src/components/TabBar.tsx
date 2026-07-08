import { catalogTypeTabLabels } from "@agromarket/contracts";
import { useNavigate, useRouterState } from "@tanstack/react-router";
import { getRememberedHref, resetTab, sectionOf, tabRootPath, type TabSection } from "../lib/tabHistory";
import { useKeyboardOpen } from "../lib/useKeyboardOpen";

const tabs: { section: TabSection; label: string; icon: IconKind }[] = [
  { section: "services", label: catalogTypeTabLabels.service, icon: "services" },
  { section: "products", label: catalogTypeTabLabels.product, icon: "products" },
  { section: "general", label: "Общее", icon: "general" }
];

type IconKind = "services" | "products" | "general";

function TabIcon({ kind }: { kind: IconKind }) {
  if (kind === "services") {
    return (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M3 21h18M5 21V10l7-6 7 6v11M9 21v-6h6v6" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    );
  }
  if (kind === "products") {
    return (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path
          d="M4 8l8-5 8 5-8 5-8-5Zm0 0v8l8 5m0-13v13m8-13v8l-8 5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <circle cx="12" cy="8" r="4" />
      <path d="M4 21c0-4.4 3.6-8 8-8s8 3.6 8 8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** Нижняя панель из трёх вкладок; помнит последний открытый экран каждой вкладки. */
export function TabBar() {
  const navigate = useNavigate();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const keyboardOpen = useKeyboardOpen();

  const activeSection = sectionOf(pathname) ?? undefined;

  function handleTap(section: TabSection) {
    const root = tabRootPath(section);
    if (section === activeSection) {
      resetTab(section);
      navigate({ href: root });
      return;
    }
    navigate({ href: getRememberedHref(section) ?? root });
  }

  return (
    <nav className={`tabbar${keyboardOpen ? " tabbar--hidden" : ""}`}>
      <div className="tabbar-inner">
        {tabs.map((tab) => (
          <button
            key={tab.section}
            type="button"
            className={`tabbar-item${tab.section === activeSection ? " tabbar-item--active" : ""}`}
            onClick={() => handleTap(tab.section)}
          >
            <TabIcon kind={tab.icon} />
            <span>{tab.label}</span>
          </button>
        ))}
      </div>
    </nav>
  );
}
