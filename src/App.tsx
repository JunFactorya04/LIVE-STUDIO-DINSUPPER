import { useState } from "react";
import { isRemote } from "./platform/backend";
import { ShareSync } from "./share/ShareSync";
import { Sidebar, TabBar, Toolbar } from "./components/Shell";
import { StatusChip } from "./components/StatusChip";
import { useI18n } from "./i18n";
import { useLiveSession } from "./live/useLiveSession";
import { NAV_ITEMS, type PageId } from "./navigation";
import { AutoPrint } from "./pages/AutoPrint";
import { ConsolePage } from "./pages/ConsolePage";
import { DashboardPage } from "./pages/DashboardPage";
import { OrdersPage } from "./pages/OrdersPage";
import { OverlayPage } from "./pages/OverlayPage";
import { PlaceholderPage } from "./pages/PlaceholderPage";
import { ReportPage } from "./pages/ReportPage";
import { RepliesPage } from "./pages/RepliesPage";
import { SettingsPage } from "./pages/SettingsPage";
import { WorkflowPage } from "./pages/WorkflowPage";
import { InventoryPage } from "./pages/InventoryPage";
import { WarehousePage } from "./pages/WarehousePage";
import { CarriersPage } from "./pages/CarriersPage";
import { ShipPage } from "./pages/ShipPage";
import { SetupPage } from "./pages/SetupPage";

export function App({ initialPage = isRemote() ? "console" : "setup" }: { initialPage?: PageId }) {
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
          <PageBody id={page} onStarted={() => setPage("console")} onNavigate={setPage} />
        </div>
      </main>
      <TabBar current={page} onSelect={setPage} />
      <ShareSync />
      {!isRemote() && <AutoPrint />}
    </div>
  );
}

function PageBody({
  id,
  onStarted,
  onNavigate,
}: {
  id: PageId;
  onStarted: () => void;
  onNavigate: (page: PageId) => void;
}) {
  switch (id) {
    case "setup":
      return <SetupPage onStarted={onStarted} />;
    case "console":
      return <ConsolePage />;
    case "dashboard":
      return <DashboardPage onNavigate={onNavigate} />;
    case "replies":
      return <RepliesPage />;
    case "overlay":
      return <OverlayPage />;
    case "orders":
      return <OrdersPage />;
    case "flow":
      return <WorkflowPage onNavigate={onNavigate} />;
    case "ship":
      return <ShipPage />;
    case "inventory":
      return <InventoryPage />;
    case "warehouse":
      return <WarehousePage />;
    case "carriers":
      return <CarriersPage />;
    case "report":
      return <ReportPage />;
    case "settings":
      return <SettingsPage />;
    default:
      return <PlaceholderPage phase={NAV_ITEMS.find((n) => n.id === id)?.phase ?? 0} />;
  }
}
