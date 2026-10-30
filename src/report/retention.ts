import type { ReportClient } from "./client";

// How long finished sessions are kept. 0 = keep forever. The default is stated in the UI.

export const RETENTION_OPTIONS = [0, 30, 90, 180, 365] as const;
export type RetentionDays = (typeof RETENTION_OPTIONS)[number];
export const DEFAULT_RETENTION_DAYS: RetentionDays = 90;
const KEY = "live-studio.retention-days";

export function loadRetentionDays(): RetentionDays {
  try {
    const raw = Number(localStorage.getItem(KEY));
    if (localStorage.getItem(KEY) !== null && RETENTION_OPTIONS.includes(raw as RetentionDays)) {
      return raw as RetentionDays;
    }
  } catch {
    /* storage unavailable: fall back to the default */
  }
  return DEFAULT_RETENTION_DAYS;
}

export function saveRetentionDays(days: RetentionDays): void {
  try {
    localStorage.setItem(KEY, String(days));
  } catch {
    /* not persisted; the choice still applies until the app closes */
  }
}

/** Run once at start, before the last session is loaded. Never blocks the app on failure. */
export async function runRetention(
  client: ReportClient,
  days = loadRetentionDays(),
): Promise<number> {
  if (!client.available || days === 0) return 0;
  try {
    return await client.purgeOlder(days);
  } catch {
    return 0;
  }
}
