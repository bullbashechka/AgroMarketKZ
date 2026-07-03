import type { ReactNode } from "react";
import { TabBar } from "./TabBar";

export function AppShell({ children }: { children: ReactNode }) {
  return (
    <div className="app-shell">
      <main className="app-content">{children}</main>
      <TabBar />
    </div>
  );
}
