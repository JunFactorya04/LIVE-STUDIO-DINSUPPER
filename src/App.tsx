import { useState } from "react";
import { Sidebar, TabBar, Toolbar } from "./components/Shell";
import { EmptyState } from "./components/States";
import { NAV_ITEMS, type PageId } from "./navigation";
import { vi } from "./i18n/vi";

export function App() {
  const [page, setPage] = useState<PageId>("dashboard");
  const meta = vi.pages[page];

  return (
    <div className="app">
      <Sidebar current={page} onSelect={setPage} />
      <main className="main">
        <Toolbar title={meta.title} subtitle={meta.subtitle} />
        <div className="content">
          <PageBody id={page} />
        </div>
      </main>
      <TabBar current={page} onSelect={setPage} />
    </div>
  );
}

// Each section starts empty. Real data and screens are added one section at a time.
function PageBody({ id }: { id: PageId }) {
  const label = NAV_ITEMS.find((n) => n.id === id)?.label ?? "";

  return (
    <div className="page page--no-inspector">
      <section className="box" aria-label={label}>
        <EmptyState title={`${label}: ${vi.states.emptyTitle.toLowerCase()}`} />
      </section>
    </div>
  );
}
