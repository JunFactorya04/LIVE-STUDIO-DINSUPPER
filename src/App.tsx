import { useState } from "react";
import { Sidebar, TabBar, Toolbar } from "./components/Shell";
import { StatusChip } from "./components/StatusChip";
import { useI18n } from "./i18n";
import { useLiveSession } from "./live/useLiveSession";
import { NAV_ITEMS, type PageId } from "./navigation";
import { ConsolePage } from "./pages/ConsolePage";
import { OrdersPage } from "./pages/OrdersPage";
import { OverlayPage } from "./pages/OverlayPage";
import { PlaceholderPage } from "./pages/PlaceholderPage";
import { RepliesPage } from "./pages/RepliesPage";
import { SettingsPage } from "./pages/SettingsPage";
import { SetupPage } from "./pages/SetupPage";

export function App({ initialPage = "setup" }: { initialPage?: PageId }) {
  const [page, setPage] = useState<PageId>(initialPage);
  const { t } = useI18n();
  const { status } = useLiveSession();
  const meta = t.pages[page];

  return (
    <div className="app">
      <Sidebar current={page} onSelect={setPage} />
      <main className="main">
        <Toolbar
          title={meta.title}
          subtitle={meta.subtitle}
          actions={<StatusChip status={status} />}
        />
        <div className="content">
          <PageBody id={page} onStarted={() => setPage("console")} />
        </div>
      </main>
      <TabBar current={page} onSelect={setPage} />
    </div>
  );
}

function PageBody({ id, onStarted }: { id: PageId; onStarted: () => void }) {
  switch (id) {
    case "setup":
      return <SetupPage onStarted={onStarted} />;
    case "console":
      return <ConsolePage />;
    case "replies":
      return <RepliesPage />;
    case "overlay":
      return <OverlayPage />;
    case "orders":
      return <OrdersPage />;
    case "settings":
      return <SettingsPage />;
    default:
      return <PlaceholderPage phase={NAV_ITEMS.find((n) => n.id === id)?.phase ?? 0} />;
  }
}
