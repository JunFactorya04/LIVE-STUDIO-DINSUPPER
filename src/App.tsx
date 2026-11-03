import { useEffect, useRef, useState } from "react";
import { onBrowserRequest } from "./browser/route";
import { hasTauri, isRemote } from "./platform/backend";
import { requestWarehouseTab, routeScan, scopeOf, type ScanTarget } from "./warehouse/relay";
import { ShareSync } from "./share/ShareSync";
import { ToastHost } from "./components/Toast";
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
import { ExpensesPage } from "./pages/ExpensesPage";
import { HomePage } from "./pages/HomePage";
import { ScanPage } from "./pages/ScanPage";
import { CameraButton } from "./camera/CameraScanner";
import { WarehousePage } from "./pages/WarehousePage";
import { PosPage } from "./pages/PosPage";
import { isUnitCode } from "./warehouse/stats";
import { CarriersPage } from "./pages/CarriersPage";
import { ShipPage } from "./pages/ShipPage";
import { SetupPage } from "./pages/SetupPage";
import { AdsPage } from "./pages/AdsPage";
import { BrowserPage } from "./pages/BrowserPage";

const TARGET_PAGE: Record<ScanTarget, PageId> = {
  pay: "pos",
  ship: "ship",
  out: "warehouse",
  count: "warehouse",
};

export function App({ initialPage = isRemote() ? "home" : "setup" }: { initialPage?: PageId }) {
  const [page, setPage] = useState<PageId>(initialPage);
  const { t } = useI18n();
  const { status } = useLiveSession();
  const meta = t.pages[page];
  // A carrier or TikTok page asked to open inside the app: go to the Browser tab, which loads it.
  useEffect(() => onBrowserRequest(() => setPage("browser")), []);

  // A phone's scan screen sent a code for one screen ("Thanh toán", "Đơn ship", "Xuất kho",
  // "Kiểm kê"): open that screen here, then hand it the code (src/warehouse/relay.ts).
  const pageRef = useRef(page);
  pageRef.current = page;
  useEffect(() => {
    if (isRemote() || !hasTauri()) return;
    let off: (() => void) | undefined;
    let alive = true;
    void import("@tauri-apps/api/event").then(async ({ listen }) => {
      const u = await listen<{ code: string; target: ScanTarget }>("remote-scan-target", (e) => {
        const { code, target } = e.payload;
        const to: PageId = TARGET_PAGE[target];
        const warehouse = target === "out" || target === "count";
        if (warehouse) requestWarehouseTab(target === "out" ? "ship" : "count");
        const moving = pageRef.current !== to;
        if (moving) setPage(to);
        routeScan(code, scopeOf(target), moving || warehouse);
      });
      if (alive) off = u;
      else u();
    });
    return () => {
      alive = false;
      off?.();
    };
  }, []);

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
          {/* Keyed by page so each switch replays the short fade-up (native.css .page-enter).
              Not for the Browser tab: its native webview is placed by the page's position,
              which must not be mid-animation when it is measured. */}
          <div className={page === "browser" ? "page-host" : "page-host page-enter"} key={page}>
            <PageBody id={page} onStarted={() => setPage("console")} onNavigate={setPage} />
          </div>
        </div>
      </main>
      <TabBar current={page} onSelect={setPage} />
      <ShareSync />
      <ToastHost closeLabel={t.common.close} />
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
    case "home":
      return <HomePage onNavigate={onNavigate} />;
    case "scan":
      return <ScanPage />;
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
      return <ShipPage camera={(onScan) => <CameraButton onScan={onScan} accept={isUnitCode} />} />;
    case "pos":
      return <PosPage camera={(onScan) => <CameraButton onScan={onScan} accept={isUnitCode} />} />;
    case "expenses":
      return <ExpensesPage />;
    case "warehouse":
      return (
        <WarehousePage camera={(onScan) => <CameraButton onScan={onScan} accept={isUnitCode} />} />
      );
    case "carriers":
      return <CarriersPage />;
    case "report":
      return <ReportPage />;
    case "ads":
      return <AdsPage />;
    case "browser":
      return <BrowserPage onNavigate={onNavigate} />;
    case "settings":
      return <SettingsPage />;
    default:
      return <PlaceholderPage phase={NAV_ITEMS.find((n) => n.id === id)?.phase ?? 0} />;
  }
}
