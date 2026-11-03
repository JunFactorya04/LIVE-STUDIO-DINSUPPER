import { useEffect, useSyncExternalStore } from "react";
import { Icon } from "./Icon";

// Banner notifications, top right (top on a phone), the way macOS shows them: one line of what
// just happened, gone after a few seconds, an optional action ("Xem file"). For short "done"
// news only — errors that need the seller's attention stay next to the thing that failed.

export type ToastTone = "ok" | "info" | "error";
export interface ToastItem {
  id: number;
  text: string;
  tone: ToastTone;
  action?: { label: string; run: () => void };
  leaving?: boolean;
}

const SHOW_MS: Record<ToastTone, number> = { ok: 3500, info: 4500, error: 7000 };
const LEAVE_MS = 160;
const MAX = 3;

let items: ToastItem[] = [];
let next = 1;
let hosts = 0;
const subs = new Set<() => void>();
const emit = () => subs.forEach((f) => f());

function dismiss(id: number) {
  if (!items.some((t) => t.id === id && !t.leaving)) return;
  items = items.map((t) => (t.id === id ? { ...t, leaving: true } : t));
  emit();
  setTimeout(() => {
    items = items.filter((t) => t.id !== id);
    emit();
  }, LEAVE_MS);
}

/**
 * Show a toast. Returns false when no toast area is on screen (a page rendered on its own, as
 * in a test), so the caller can show the message in its usual place instead.
 */
export function toast(
  text: string,
  opts: { tone?: ToastTone; action?: ToastItem["action"] } = {},
): boolean {
  if (hosts === 0) return false;
  const tone = opts.tone ?? "ok";
  // The same news twice in a row (a scan repeated) refreshes instead of stacking.
  items = items.filter((t) => t.text !== text);
  const item: ToastItem = { id: next++, text, tone, action: opts.action };
  items = [...items, item].slice(-MAX);
  emit();
  setTimeout(() => dismiss(item.id), SHOW_MS[tone]);
  return true;
}

export function ToastHost({ closeLabel }: { closeLabel: string }) {
  const list = useSyncExternalStore(
    (f) => {
      subs.add(f);
      return () => subs.delete(f);
    },
    () => items,
  );
  useEffect(() => {
    hosts += 1;
    return () => {
      hosts -= 1;
    };
  }, []);
  return (
    <div className="toasts" aria-live="polite" aria-relevant="additions">
      {list.map((t) => (
        <div
          key={t.id}
          className={`toast toast--${t.tone}${t.leaving ? " is-leaving" : ""}`}
          role={t.tone === "error" ? "alert" : "status"}
        >
          <span className="toast__icon">
            <Icon
              name={t.tone === "ok" ? "checkCircle" : t.tone === "error" ? "warning" : "info"}
              size={17}
            />
          </span>
          <p className="toast__text">{t.text}</p>
          <span className="toast__actions">
            {t.action && (
              <button
                type="button"
                className="btn"
                onClick={() => {
                  t.action?.run();
                  dismiss(t.id);
                }}
              >
                {t.action.label}
              </button>
            )}
            <button
              type="button"
              className="icon-btn"
              aria-label={closeLabel}
              title={closeLabel}
              onClick={() => dismiss(t.id)}
            >
              <Icon name="close" size={13} />
            </button>
          </span>
        </div>
      ))}
    </div>
  );
}
