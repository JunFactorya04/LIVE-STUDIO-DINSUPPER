import { vi } from "./i18n/vi";

// One list of sections drives the sidebar (desktop) and tab bar (phone).
export type PageId = "dashboard" | "live" | "platforms" | "content" | "schedule" | "settings";

export interface NavItem {
  id: PageId;
  label: string;
  section: "main" | "manage";
}

export const NAV_ITEMS: NavItem[] = [
  { id: "dashboard", label: vi.nav.dashboard, section: "main" },
  { id: "live", label: vi.nav.live, section: "main" },
  { id: "platforms", label: vi.nav.platforms, section: "manage" },
  { id: "content", label: vi.nav.content, section: "manage" },
  { id: "schedule", label: vi.nav.schedule, section: "manage" },
  { id: "settings", label: vi.nav.settings, section: "manage" },
];
