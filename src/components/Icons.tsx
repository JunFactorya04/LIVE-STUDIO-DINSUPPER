import type { PageId } from "../navigation";

// Outline icons, 1.5px stroke, 17px in the sidebar: close to the SF Symbols style.
// Replace with real SF Symbols when a native shell is added.
const paths: Record<PageId | "more", string> = {
  setup: "M4 7h10M18 7h2M4 17h2M10 17h10M14 4v6M6 14v6",
  console: "M4 5h16v11H10l-4 3v-3H4z",
  dashboard: "M4 4h7v7H4zM13 4h7v4h-7zM13 11h7v9h-7zM4 14h7v6H4z",
  orders: "M5 4h14v16H5zM9 9h6M9 13h6",
  ship: "M3 7h11v9H3zM14 10h4l3 3v3h-7zM7 19a1.5 1.5 0 1 0 0-.01M17 19a1.5 1.5 0 1 0 0-.01",
  replies: "M10 8L5 12l5 4M5 12h9a5 5 0 0 1 5 5",
  overlay: "M12 4l8 4-8 4-8-4zM4 12l8 4 8-4M4 16l8 4 8-4",
  report: "M5 20V10M12 20V4M19 20v-7",
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
