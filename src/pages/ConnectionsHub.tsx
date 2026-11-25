import { NavIcon } from "../components/Icons";

// The picture at the top of Settings: LIVE STUDIO in the middle, everything it talks to around
// it. A connection that is working draws a solid line with dots moving along it, from where the
// information comes (TikTok, the phone, the scanner) into the app, and from the app out to where
// it goes (printers, carriers). Not set up: a dashed grey line. Each node opens its card below.

export type ConnId =
  "tiktok" | "phone" | "scanner" | "ai" | "printer" | "label" | "carriers" | "web";

export type ConnState = "on" | "busy" | "off";

export const CONN_ICON: Record<ConnId, string> = {
  tiktok: "M14 4v10.5a3.5 3.5 0 1 1-3-3.46M14 4c.5 2.5 2.5 4 5 4",
  phone: "M8 3h8a1 1 0 0 1 1 1v16a1 1 0 0 1-1 1H8a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1zM11 18h2",
  scanner:
    "M4 8V5a1 1 0 0 1 1-1h3M20 8V5a1 1 0 0 0-1-1h-3M4 16v3a1 1 0 0 0 1 1h3M20 16v3a1 1 0 0 1-1 1h-3M7 12h10",
  ai: "M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8zM18.5 15.5l.7 1.8 1.8.7-1.8.7-.7 1.8-.7-1.8-1.8-.7 1.8-.7z",
  printer:
    "M7 9V4h10v5M7 17H5a2 2 0 0 1-2-2v-4a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v4a2 2 0 0 1-2 2h-2M7 14h10v6H7z",
  label: "M4 6v12M7 6v12M10 6v9M13 6v12M16 6v9M20 6v12",
  carriers: "M3 7h11v9H3zM14 10h4l3 3v3h-7zM7 19a1.5 1.5 0 1 0 0-.01M17 19a1.5 1.5 0 1 0 0-.01",
  web: "M12 4a8 8 0 1 0 0 16 8 8 0 0 0 0-16M4 12h16M12 4c2.5 2.2 2.5 13.8 0 16M12 4c-2.5 2.2-2.5 13.8 0 16",
};

/** Where each node sits (viewBox 400 × 300) and which way its information flows. */
const LAYOUT: Record<ConnId, { x: number; y: number; dir: "in" | "out" }> = {
  tiktok: { x: 56, y: 62, dir: "in" },
  phone: { x: 40, y: 152, dir: "in" },
  scanner: { x: 64, y: 240, dir: "in" },
  ai: { x: 200, y: 34, dir: "out" },
  printer: { x: 344, y: 62, dir: "out" },
  label: { x: 360, y: 152, dir: "out" },
  carriers: { x: 336, y: 240, dir: "out" },
  web: { x: 200, y: 272, dir: "out" },
};

const HUB = { x: 200, y: 152 };

export const CONN_ORDER: readonly ConnId[] = [
  "tiktok",
  "phone",
  "scanner",
  "ai",
  "printer",
  "label",
  "carriers",
  "web",
];

/** A soft curve from the source to the target (into the hub for "in", out of it for "out"). */
function curve(id: ConnId): string {
  const n = LAYOUT[id];
  const [a, b] = n.dir === "in" ? [n, HUB] : [HUB, n];
  const mx = (a.x + b.x) / 2;
  return `M${a.x} ${a.y} C${mx} ${a.y}, ${mx} ${b.y}, ${b.x} ${b.y}`;
}

export function ConnGlyph({ id, size = 20 }: { id: ConnId; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={CONN_ICON[id]} />
    </svg>
  );
}

export function ConnectionsHub({
  states,
  labels,
  stateLabels,
  appName,
  onOpen,
}: {
  states: Record<ConnId, ConnState>;
  labels: Record<ConnId, string>;
  stateLabels: Record<ConnState, string>;
  appName: string;
  onOpen: (id: ConnId) => void;
}) {
  return (
    <div className="hub">
      <svg className="hub__lines" viewBox="0 0 400 300" aria-hidden="true">
        {CONN_ORDER.map((id) => (
          <g key={id} className={`hub__link is-${states[id]} hub__link--${id}`}>
            <path className="hub__track" d={curve(id)} />
            {states[id] !== "off" && <path className="hub__flow" d={curve(id)} />}
          </g>
        ))}
      </svg>
      <div className="hub__center" style={{ left: "50%", top: `${(HUB.y / 300) * 100}%` }}>
        <span className="hub__app">
          <NavIcon id="dashboard" size={30} />
        </span>
        <strong>{appName}</strong>
      </div>
      {CONN_ORDER.map((id) => (
        <button
          key={id}
          type="button"
          className={`hub__node hub__node--${id} is-${states[id]}`}
          style={{ left: `${(LAYOUT[id].x / 400) * 100}%`, top: `${(LAYOUT[id].y / 300) * 100}%` }}
          onClick={() => onOpen(id)}
          aria-label={`${labels[id]}: ${stateLabels[states[id]]}`}
        >
          <span className="hub__dot">
            <ConnGlyph id={id} />
          </span>
          <span className="hub__name">{labels[id]}</span>
        </button>
      ))}
    </div>
  );
}
