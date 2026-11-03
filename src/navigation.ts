// One list of sections drives the sidebar (desktop) and the tab bar (phone).
// Labels are looked up in the i18n catalogue by id: t.nav[id], t.pages[id].

export type PageId =
  | "home"
  | "scan"
  | "setup"
  | "console"
  | "dashboard"
  | "orders"
  | "flow"
  | "ship"
  | "pos"
  | "warehouse"
  | "expenses"
  | "carriers"
  | "replies"
  | "overlay"
  | "report"
  | "ads"
  | "browser"
  | "settings";

export interface NavItem {
  id: PageId;
  section: "main" | "manage";
  /** Shown directly in the phone tab bar; the rest go under "More" (max 5 tabs). */
  tab: boolean;
  /** Phase of docs/IMPLEMENTATION_PLAN_TIKTOK_LIVE.md that delivers the page; undefined = available now. */
  phase?: number;
}

export const NAV_ITEMS: NavItem[] = [
  { id: "home", section: "main", tab: false },
  { id: "scan", section: "main", tab: false },
  { id: "setup", section: "main", tab: true },
  { id: "console", section: "main", tab: true },
  { id: "dashboard", section: "manage", tab: false },
  { id: "orders", section: "manage", tab: true },
  { id: "flow", section: "manage", tab: false },
  { id: "ship", section: "manage", tab: false },
  { id: "pos", section: "manage", tab: true },
  { id: "carriers", section: "manage", tab: false },
  { id: "warehouse", section: "manage", tab: false },
  { id: "expenses", section: "manage", tab: false },
  { id: "replies", section: "manage", tab: true },
  { id: "overlay", section: "manage", tab: false },
  { id: "report", section: "manage", tab: false },
  { id: "ads", section: "manage", tab: false },
  { id: "browser", section: "manage", tab: false },
  { id: "settings", section: "manage", tab: false },
];

/** A phone opened from the sharing link works the orders; setup and overlay stay on the computer
 *  (its Settings page shows only the phone's own language and light/dark). */
const REMOTE_PAGES: ReadonlySet<PageId> = new Set([
  "home",
  "scan",
  "console",
  "dashboard",
  "orders",
  "flow",
  "ship",
  "pos",
  "warehouse",
  "replies",
  "report",
  "settings",
]);

/** The phone's own start screen and scan screen: only on a phone opened from the sharing link. */
const PHONE_ONLY: ReadonlySet<PageId> = new Set(["home", "scan"]);

/** A phone's tab bar: home, orders, the big scan button in the middle, ship orders, then More. */
export const PHONE_TABS: readonly PageId[] = ["home", "orders", "scan", "ship"];

export function visibleNav(remote: boolean): NavItem[] {
  return remote
    ? NAV_ITEMS.filter((i) => REMOTE_PAGES.has(i.id))
    : NAV_ITEMS.filter((i) => !PHONE_ONLY.has(i.id));
}
