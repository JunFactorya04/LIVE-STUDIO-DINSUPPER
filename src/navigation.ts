// One list of sections drives the sidebar (desktop) and the tab bar (phone).
// Labels are looked up in the i18n catalogue by id: t.nav[id], t.pages[id].

export type PageId = "setup" | "console" | "orders" | "replies" | "overlay" | "report" | "settings";

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
  { id: "orders", section: "manage", tab: true, phase: 3 },
  { id: "replies", section: "manage", tab: true, phase: 4 },
  { id: "overlay", section: "manage", tab: false, phase: 4 },
  { id: "report", section: "manage", tab: false, phase: 6 },
  { id: "settings", section: "manage", tab: false },
];
