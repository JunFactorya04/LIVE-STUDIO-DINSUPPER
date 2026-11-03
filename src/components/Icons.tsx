import type { PageId } from "../navigation";

// Outline icons, 1.5px stroke, 17px in the sidebar: close to the SF Symbols style.
// Replace with real SF Symbols when a native shell is added.
const paths: Record<PageId | "more", string> = {
  home: "M4 11l8-7 8 7M6 9.5V20h4.5v-5h3v5H18V9.5",
  scan: "M4 8V5a1 1 0 0 1 1-1h3M20 8V5a1 1 0 0 0-1-1h-3M4 16v3a1 1 0 0 0 1 1h3M20 16v3a1 1 0 0 1-1 1h-3M7 12h10",
  setup: "M4 7h10M18 7h2M4 17h2M10 17h10M14 4v6M6 14v6",
  console: "M4 5h16v11H10l-4 3v-3H4z",
  dashboard: "M4 4h7v7H4zM13 4h7v4h-7zM13 11h7v9h-7zM4 14h7v6H4z",
  orders: "M5 4h14v16H5zM9 9h6M9 13h6",
  flow: "M5 6h4v4H5zM15 14h4v4h-4zM9 8h4a2 2 0 0 1 2 2v4",
  ship: "M3 7h11v9H3zM14 10h4l3 3v3h-7zM7 19a1.5 1.5 0 1 0 0-.01M17 19a1.5 1.5 0 1 0 0-.01",
  pos: "M4 4h4M4 4v4M16 4h4M20 4v4M4 16v4M4 20h4M20 16v4M20 20h-4M8 8h2v2H8zM14 8h2v2h-2zM8 14h2v2H8zM14 14h2v2h-2z",
  warehouse: "M4 8l8-4 8 4v8l-8 4-8-4zM4 8l8 4 8-4M12 12v8",
  expenses: "M6 3h12v18l-3-2-3 2-3-2-3 2zM9 8h6M9 12h6M9 16h3",
  carriers: "M12 4a8 8 0 1 0 0 16 8 8 0 0 0 0-16M4 12h16M12 4c3 3 3 13 0 16",
  replies: "M10 8L5 12l5 4M5 12h9a5 5 0 0 1 5 5",
  overlay: "M12 4l8 4-8 4-8-4zM4 12l8 4 8-4M4 16l8 4 8-4",
  report: "M5 20V10M12 20V4M19 20v-7",
  ads: "M3 10v4h3l5 4V6l-5 4zM17 9a4 4 0 0 1 0 6M20 6a8 8 0 0 1 0 12",
  browser:
    "M12 4a8 8 0 1 0 0 16 8 8 0 0 0 0-16M4 12h16M12 4c2.5 2.2 2.5 13.8 0 16M12 4c-2.5 2.2-2.5 13.8 0 16",
  settings: "M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6zM4 12h2M18 12h2M12 4v2M12 18v2",
  more: "M6 12h.01M12 12h.01M18 12h.01",
};

export function NavIcon({ id, size = 17 }: { id: PageId | "more"; size?: number }) {
  return (
    <svg
      className="icon"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={id === "more" ? 3 : 1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d={paths[id]} />
    </svg>
  );
}
