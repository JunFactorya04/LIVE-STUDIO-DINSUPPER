import type { PageId } from "../navigation";
import { hasTauri, isRemote } from "../platform/backend";

// Where a carrier's or TikTok's page opens: inside the app's own "Trình duyệt" tab (default),
// or the system browser. The seller picks per kind in Settings; the tab also has a button to
// send the page it shows out to the system browser when a site misbehaves inside the app.

export type WebKind = "carrier" | "tiktok";
export type OpenMode = "app" | "external";

export interface BrowserRequest {
  url: string;
  /** Phone layout (an iPhone user agent): what TikTok's pages need. */
  mobile: boolean;
  /** The page the seller came from, for the "back to …" button. */
  from?: PageId;
}

export const TIKTOK_LOGIN_URL = "https://www.tiktok.com/login/qrcode";
/** A buyer's TikTok profile, where TikTok's own "Message" button opens the chat. */
export const buyerUrl = (tiktokId: string) =>
  `https://www.tiktok.com/@${encodeURIComponent(tiktokId.trim().replace(/^@/, ""))}`;

const KEY = (kind: WebKind) => `live-studio.web-open.${kind}`;

/** TikTok's checks (403, puzzle) block it inside the app's webview, so TikTok opens in the
 * seller's own Chrome/Edge unless they chose otherwise; carrier sites open inside the app. */
const DEFAULT_MODE: Record<WebKind, OpenMode> = { carrier: "app", tiktok: "external" };

export function loadOpenMode(kind: WebKind): OpenMode {
  try {
    const v = localStorage.getItem(KEY(kind));
    return v === "external" || v === "app" ? v : DEFAULT_MODE[kind];
  } catch {
    return DEFAULT_MODE[kind];
  }
}

export function saveOpenMode(kind: WebKind, mode: OpenMode): void {
  try {
    localStorage.setItem(KEY(kind), mode);
  } catch {
    // not remembered; the choice still applies until the app restarts
  }
}

let pending: BrowserRequest | undefined;
const listeners = new Set<(r: BrowserRequest) => void>();

/** The app shell listens to switch to the Browser tab; the tab listens to load the page. */
export function onBrowserRequest(f: (r: BrowserRequest) => void): () => void {
  listeners.add(f);
  return () => {
    listeners.delete(f);
  };
}

/** The request the Browser tab has not opened yet (it may mount after the request was made). */
export function takeBrowserRequest(): BrowserRequest | undefined {
  const r = pending;
  pending = undefined;
  return r;
}

export function requestBrowser(r: BrowserRequest): void {
  pending = r;
  for (const f of listeners) f(r);
}

/** In the desktop app with the in-app choice: opens the Browser tab; otherwise `external()`. */
export async function openWeb(
  kind: WebKind,
  url: string,
  external: () => Promise<void>,
  from?: PageId,
): Promise<OpenMode> {
  if (!hasTauri() || isRemote() || loadOpenMode(kind) === "external") {
    await external();
    return "external";
  }
  // Desktop layout for every site, TikTok included: TikTok's mobile web has no "Message" button
  // (it sends chats to the app), and a phone identity on a Mac browser draws its 403/puzzle
  // checks. The phone layout stays one checkbox away in the Browser tab.
  requestBrowser({ url, mobile: false, from });
  return "app";
}
