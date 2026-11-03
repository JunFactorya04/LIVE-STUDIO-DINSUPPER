import { hasTauri, isRemote } from "../platform/backend";

// The system's own notification (macOS Notification Center, Windows action center), only when
// the app is not the window in front — when it is, a toast says the same thing. Used for what
// the seller must not miss while working in OBS or TikTok: a new order, a print that failed.

let allowed: boolean | undefined;

async function permitted(): Promise<boolean> {
  if (allowed !== undefined) return allowed;
  try {
    const n = await import("@tauri-apps/plugin-notification");
    allowed = (await n.isPermissionGranted()) || (await n.requestPermission()) === "granted";
  } catch {
    allowed = false;
  }
  return allowed;
}

export async function notifySystem(title: string, body: string): Promise<boolean> {
  if (!hasTauri() || isRemote()) return false;
  if (typeof document !== "undefined" && document.hasFocus() && !document.hidden) return false;
  if (!(await permitted())) return false;
  try {
    const n = await import("@tauri-apps/plugin-notification");
    n.sendNotification({ title, body });
    return true;
  } catch {
    return false;
  }
}
