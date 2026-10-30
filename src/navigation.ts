// One list of sections drives the sidebar (desktop) and the tab bar (phone).
// Labels are looked up in the i18n catalogue by id: t.nav[id], t.pages[id].

export type PageId =
  | "setup"
  | "console"
  | "dashboard"
  | "orders"
  | "ship"
  | "replies"
  | "overlay"
  | "report"
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
  { id: "setup", section: "main", tab: true },
  { id: "console", section: "main", tab: true },
  { id: "dashboard", section: "manage", tab: false },
  { id: "orders", section: "manage", tab: true },
  { id: "ship", section: "manage", tab: false },
  { id: "replies", section: "manage", tab: true },
  { id: "overlay", section: "manage", tab: false },
  { id: "report", section: "manage", tab: false },
  { id: "settings", section: "manage", tab: false },
];
