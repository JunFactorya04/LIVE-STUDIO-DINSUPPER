// Where the app's commands run. In the desktop app that is Rust, through Tauri. On a phone that
// opened the sharing link from Settings it is the same Rust code reached over the local network
// with the secret token of that link. Anything else (a plain browser) has no backend at all.

const TOKEN_KEY = "live-studio.share-token";

const hasTauri = (): boolean => typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

let token: string | undefined | null = null; // null = not read yet

/** The sharing token: taken from the link (`?t=...`), kept for this tab, removed from the address bar. */
export function remoteToken(): string | undefined {
  if (hasTauri() || typeof window === "undefined") return undefined;
  if (token !== null) return token;
  token = undefined;
  try {
    const url = new URL(window.location.href);
    const fromUrl = url.searchParams.get("t");
    if (fromUrl) {
      sessionStorage.setItem(TOKEN_KEY, fromUrl);
      url.searchParams.delete("t");
      window.history.replaceState(null, "", url.pathname + url.search + url.hash);
    }
    token = sessionStorage.getItem(TOKEN_KEY) ?? undefined;
  } catch {
    // storage blocked: the link still works until the page is reloaded
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
