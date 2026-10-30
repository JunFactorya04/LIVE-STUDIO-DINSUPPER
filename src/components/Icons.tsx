import type { PageId } from "../navigation";

// Outline icons, 1.5px stroke, 17px in sidebar — close to SF Symbols style.
// Replace with real SF Symbols when a native shell is added.
const paths: Record<PageId, string> = {
  dashboard: "M3 3h7v9H3zM14 3h7v5h-7zM14 12h7v9h-7zM3 16h7v5H3z",
  live: "M12 12m-2 0a2 2 0 1 0 4 0a2 2 0 1 0-4 0M6.3 6.3a8 8 0 0 0 0 11.4M17.7 6.3a8 8 0 0 1 0 11.4",
  platforms: "M4 6h16M4 12h16M4 18h10",
  content: "M4 4h16v4H4zM4 10h16v10H4z",
  schedule: "M4 6h16v14H4zM4 10h16M8 3v4M16 3v4",
  settings: "M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6zM4 12h2M18 12h2M12 4v2M12 18v2",
};

export function NavIcon({ id, size = 17 }: { id: PageId; size?: number }) {
  return (
    <svg
      className="icon"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d={paths[id]} />
    </svg>
  );
}
