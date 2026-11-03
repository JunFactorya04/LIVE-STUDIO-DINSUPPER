import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type ReactNode,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import { createPortal } from "react-dom";
import { Icon } from "./Icon";

// A macOS sheet: dims the window, the panel springs in (slides up from the bottom on a phone),
// Esc or a click on the dimmed area closes it with a short fade, focus stays inside while it is
// open and goes back to where it was after. One component for every popup in the app.

const LEAVE_MS = 160;
const FOCUSABLE =
  'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function Sheet({
  title,
  onClose,
  children,
  footer,
  wide,
  alert,
  closeLabel,
  dismissable = true,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  wide?: boolean;
  /** A small centred alert (a question with two answers) instead of a sheet. */
  alert?: boolean;
  /** Label of the corner close button; no button when left out. */
  closeLabel?: string;
  /** False: Esc and the dimmed area do not close it (the footer must). */
  dismissable?: boolean;
}) {
  const titleId = useId();
  const panel = useRef<HTMLDivElement>(null);
  const [leaving, setLeaving] = useState(false);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  const close = useCallback(() => {
    setLeaving(true);
    window.setTimeout(() => closeRef.current(), LEAVE_MS);
  }, []);

  useEffect(() => {
    const before = document.activeElement as HTMLElement | null;
    const first = panel.current?.querySelector<HTMLElement>(FOCUSABLE);
    (first ?? panel.current)?.focus();
    return () => before?.focus?.();
  }, []);

  const onKeyDown = (e: ReactKeyboardEvent) => {
    if (e.key === "Escape" && dismissable) {
      e.stopPropagation();
      close();
      return;
    }
    if (e.key !== "Tab" || !panel.current) return;
    const items = [...panel.current.querySelectorAll<HTMLElement>(FOCUSABLE)];
    if (items.length === 0) return;
    const [a, z] = [items[0], items[items.length - 1]];
    if (e.shiftKey && document.activeElement === a) {
      e.preventDefault();
      z.focus();
    } else if (!e.shiftKey && document.activeElement === z) {
      e.preventDefault();
      a.focus();
    }
  };

  return createPortal(
    <div
      className={`sheet-scrim${leaving ? " is-leaving" : ""}`}
      onMouseDown={(e) => {
        if (dismissable && e.target === e.currentTarget) close();
      }}
      onKeyDown={onKeyDown}
    >
      <div
        ref={panel}
        className={`sheet${wide ? " sheet--wide" : ""}${alert ? " sheet--alert" : ""}`}
        role={alert ? "alertdialog" : "dialog"}
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
      >
        {alert ? (
          <div className="sheet__body">
            <h2 className="sheet__title" id={titleId}>
              {title}
            </h2>
            {children}
          </div>
        ) : (
          <>
            <div className="sheet__head">
              <h2 className="sheet__title" id={titleId}>
                {title}
              </h2>
              {closeLabel && (
                <button
                  type="button"
                  className="icon-btn sheet__close"
                  aria-label={closeLabel}
                  title={closeLabel}
                  onClick={close}
                >
                  <Icon name="close" />
                </button>
              )}
            </div>
            <div className="sheet__body">{children}</div>
          </>
        )}
        {footer && <div className="sheet__foot">{footer}</div>}
      </div>
    </div>,
    document.body,
  );
}

/**
 * An alert that asks one question: `ask()` resolves true for the confirming answer. Replaces the
 * browser's own confirm(), which looks nothing like the app and blocks the whole window.
 */
export function useConfirm(): [
  ReactNode,
  (q: {
    title: string;
    message?: string;
    ok: string;
    cancel: string;
    destructive?: boolean;
  }) => Promise<boolean>,
] {
  const [q, setQ] = useState<{
    title: string;
    message?: string;
    ok: string;
    cancel: string;
    destructive?: boolean;
    resolve: (v: boolean) => void;
  }>();
  const ask = useCallback(
    (x: { title: string; message?: string; ok: string; cancel: string; destructive?: boolean }) =>
      new Promise<boolean>((resolve) => setQ({ ...x, resolve })),
    [],
  );
  const answer = (v: boolean) => {
    q?.resolve(v);
    setQ(undefined);
  };
  const node = q ? (
    <Sheet alert title={q.title} onClose={() => answer(false)}>
      {q.message && <p className="caption">{q.message}</p>}
      <div className="sheet__foot sheet__foot--inline">
        <button type="button" className="btn" onClick={() => answer(false)}>
          {q.cancel}
        </button>
        <button
          type="button"
          className={`btn ${q.destructive ? "btn--destructive" : "btn--primary"}`}
          onClick={() => answer(true)}
        >
          {q.ok}
        </button>
      </div>
    </Sheet>
  ) : null;
  return [node, ask];
}
