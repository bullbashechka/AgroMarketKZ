export type TabSection = "services" | "products" | "general";

const rootPaths: Record<TabSection, string> = {
  services: "/services",
  products: "/products",
  general: "/general"
};

const lastHref = new Map<TabSection, string>();

function sectionOf(pathname: string): TabSection | null {
  if (pathname.startsWith("/services")) return "services";
  if (pathname.startsWith("/products")) return "products";
  if (pathname.startsWith("/general")) return "general";
  return null;
}

/** Запоминает текущий URL за той вкладкой, к которой он относится. Вызывать при каждой навигации. */
export function rememberLocation(href: string): void {
  const pathname = href.split(/[?#]/)[0] ?? href;
  const section = sectionOf(pathname);
  if (section) lastHref.set(section, href);
}

/** Последний посещённый URL вкладки, если пользователь уже в ней что-то открывал. */
export function getRememberedHref(section: TabSection): string | null {
  return lastHref.get(section) ?? null;
}

/** Сбрасывает память вкладки к её корню (повторный тап по уже активной вкладке). */
export function resetTab(section: TabSection): void {
  lastHref.delete(section);
}

export function tabRootPath(section: TabSection): string {
  return rootPaths[section];
}
