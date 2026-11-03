import { invoke, isRemote } from "../platform/backend";

// Realtime scan relay. A phone that opened the sharing link scans a code and sends it to the
// computer, whose open screen handles it at once (checkout, ship order, scan out, count). The
// code travels over the same local-network link as the other commands; nothing leaves the
// local network.
//
// The phone's scan screen can also say what a code is for (`ScanTarget`). The computer then
// opens that screen first (App.tsx) and the code waits here until it is listening: a
// "scope" listener picks up the codes queued for its scope, for up to a minute.

export type ScanTarget = "pay" | "ship" | "out" | "count";
/** Which screen consumes a target's codes. */
export type ScanScope = "pay" | "ship" | "warehouse";
export const scopeOf = (t: ScanTarget): ScanScope =>
  t === "out" || t === "count" ? "warehouse" : t;

export interface ScanRelay {
  /** Phone side: send one scanned code to the computer, optionally for one screen. */
  push(code: string, target?: ScanTarget): Promise<void>;
  /** Computer side: be told about every code a phone sends. Returns the unsubscribe. */
  listen(handler: (code: string) => void, scope?: ScanScope): Promise<() => void>;
}

// ---- computer side: codes routed to a screen that is not listening yet ----

const QUEUE_MS = 60_000;
type Pending = { code: string; scope: ScanScope; at: number };
let pending: Pending[] = [];
const scoped = new Map<ScanScope, Set<(code: string) => void>>();
const waiters = new Set<(scope: ScanScope) => void>();

/** Codes waiting for `scope`, oldest first, taken off the queue. */
export function takeQueued(scope: ScanScope): string[] {
  const now = Date.now();
  const mine = pending.filter((p) => p.scope === scope && now - p.at < QUEUE_MS);
  pending = pending.filter((p) => p.scope !== scope && now - p.at < QUEUE_MS);
  return mine.map((p) => p.code);
}

export const hasQueued = (scope: ScanScope) =>
  pending.some((p) => p.scope === scope && Date.now() - p.at < QUEUE_MS);

/** A screen (the ship page) that must open something before its listener exists. */
export function onQueued(f: (scope: ScanScope) => void): () => void {
  waiters.add(f);
  return () => {
    waiters.delete(f);
  };
}

/**
 * Deliver a targeted code: straight to the screen's listener when it has one, otherwise kept
 * until it subscribes. `hold` keeps it even then (the warehouse switches tab first).
 */
export function routeScan(code: string, scope: ScanScope, hold = false): void {
  const live = scoped.get(scope);
  if (!hold && live && live.size > 0) {
    // the newest listener is the screen in front
    [...live][live.size - 1](code);
    return;
  }
  pending.push({ code, scope, at: Date.now() });
  waiters.forEach((f) => f(scope));
}

export function createScanRelay(): ScanRelay {
  return {
    push: async (code, target) => {
      await invoke<null>("scan_push", target ? { code, target } : { code });
    },
    listen: async (handler, scope) => {
      if (isRemote()) return () => {};
      let set: Set<(code: string) => void> | undefined;
      if (scope) {
        set = scoped.get(scope) ?? new Set();
        scoped.set(scope, set);
        set.add(handler);
        setTimeout(() => takeQueued(scope).forEach(handler), 0);
      }
      const drop = () => set?.delete(handler);
      try {
        const { listen } = await import("@tauri-apps/api/event");
        const off = await listen<string>("remote-scan", (e) => {
          if (typeof e.payload === "string" && e.payload) handler(e.payload);
        });
        return () => {
          off();
          drop();
        };
      } catch {
        return drop; // not in the desktop app
      }
    },
  };
}

// ---- the warehouse tab a routed code needs ("Xuất kho" or "Kiểm kê") ----

type WhTab = "ship" | "count";
let wantTab: WhTab | undefined;
const tabListeners = new Set<(t: WhTab) => void>();

export function requestWarehouseTab(t: WhTab): void {
  wantTab = t;
  tabListeners.forEach((f) => f(t));
}

/** For the warehouse page as it mounts: the tab asked for, once. */
export function takeWarehouseTab(): WhTab | undefined {
  const t = wantTab;
  wantTab = undefined;
  return t;
}

export function onWarehouseTab(f: (t: WhTab) => void): () => void {
  tabListeners.add(f);
  return () => {
    tabListeners.delete(f);
  };
}
