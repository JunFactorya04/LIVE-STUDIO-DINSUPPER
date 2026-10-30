import { invoke, isRemote } from "../platform/backend";

// Realtime scan relay. A phone that opened the sharing link scans a code and sends it to the
// computer, whose open warehouse screen handles it at once (scan out, count). The code travels
// over the same local-network link as the other commands; nothing leaves the local network.

export interface ScanRelay {
  /** Phone side: send one scanned code to the computer. */
  push(code: string): Promise<void>;
  /** Computer side: be told about every code a phone sends. Returns the unsubscribe. */
  listen(handler: (code: string) => void): Promise<() => void>;
}

export function createScanRelay(): ScanRelay {
  return {
    push: async (code) => {
      await invoke<null>("scan_push", { code });
    },
    listen: async (handler) => {
      if (isRemote()) return () => {};
      try {
        const { listen } = await import("@tauri-apps/api/event");
        return await listen<string>("remote-scan", (e) => {
          if (typeof e.payload === "string" && e.payload) handler(e.payload);
        });
      } catch {
        return () => {}; // not in the desktop app
      }
    },
  };
}
