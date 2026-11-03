// Where the app's commands run. In the desktop app that is Rust, through Tauri. On a phone that
// opened the sharing link from Settings it is the same Rust code reached over the local network
// with the secret token of that link. Anything else (a plain browser) has no backend at all.

const TOKEN_KEY = "live-studio.share-token";

export const hasTauri = (): boolean =>
  typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

let token: string | undefined | null = null; // null = not read yet

/**
 * The sharing token: taken from the link (`?t=...`) and remembered on the phone. The link keeps
 * it, so "Add to Home Screen" saves an icon that opens the app already signed in (iOS keeps the
 * address as it is when the icon is added). The computer keeps the same token between restarts
 * until the seller makes a new link in Settings, which signs every saved phone out.
 */
export function remoteToken(): string | undefined {
  if (hasTauri() || typeof window === "undefined") return undefined;
  if (token !== null) return token;
  token = undefined;
  try {
    const fromUrl = new URL(window.location.href).searchParams.get("t");
    if (fromUrl) {
      localStorage.setItem(TOKEN_KEY, fromUrl);
      token = fromUrl;
    } else {
      token = localStorage.getItem(TOKEN_KEY) ?? sessionStorage.getItem(TOKEN_KEY) ?? undefined;
    }
  } catch {
    // storage blocked: the token in the link still works for this visit
    token = new URL(window.location.href).searchParams.get("t") ?? undefined;
  }
  return token;
}

/** Opened from the sharing link on another device. */
export const isRemote = (): boolean => remoteToken() !== undefined;

/** The commands can run somewhere: the desktop app, or the computer behind a sharing link. */
export const hasBackend = (): boolean => hasTauri() || isRemote();

export async function invoke<T>(cmd: string, args: Record<string, unknown> = {}): Promise<T> {
  if (hasTauri()) {
    const { invoke: tauriInvoke } = await import("@tauri-apps/api/core");
    return tauriInvoke<T>(cmd, args);
  }
  const t = remoteToken();
  if (!t) throw new Error("NOT_DESKTOP");
  let res: Response;
  try {
    res = await fetch("/api/invoke", {
      method: "POST",
      headers: { "content-type": "application/json", "x-token": t },
      body: JSON.stringify({ cmd, args }),
    });
  } catch {
    throw "UNREACHABLE";
  }
  if (res.status === 401 || res.status === 429) throw "UNAUTHORIZED";
  const body = (await res.json().catch(() => undefined)) as
    { ok: boolean; data?: T; error?: string } | undefined;
  if (!body?.ok) throw body?.error ?? "REMOTE_ERROR";
  return body.data as T;
}
