import { useEffect, useRef, useState } from "react";
import { EmptyState } from "../components/States";
import { hasTauri, invoke } from "../platform/backend";
import { useI18n } from "../i18n";

// A manual, view-only browser tab: an address bar, back/forward/reload, and a mobile-mode
// toggle. Nothing here reads, clicks or fills the page on the seller's behalf — the native
// webview is a real browser the seller drives themselves, exactly like opening a new tab. It
// never persists its own session/profile beyond whatever the OS webview keeps by default, and
// it is never reachable from MCP or any other outside channel — only the buttons below call it,
// each wired to the seller's own click.

type BrowserErrorCode = "EMPTY_URL" | "BAD_URL" | "BAD_SCHEME" | "NOT_OPEN" | "NO_MAIN_WINDOW";

const BROWSER_ERROR_CODES: readonly BrowserErrorCode[] = [
  "EMPTY_URL",
  "BAD_URL",
  "BAD_SCHEME",
  "NOT_OPEN",
  "NO_MAIN_WINDOW",
];

function isKnownError(x: unknown): x is BrowserErrorCode {
  return typeof x === "string" && (BROWSER_ERROR_CODES as readonly string[]).includes(x);
}

export function BrowserPage() {
  const { t } = useI18n();
  const b = t.browser;
  const containerRef = useRef<HTMLDivElement>(null);
  const [addressInput, setAddressInput] = useState("");
  const [openedUrl, setOpenedUrl] = useState<string>();
  const [mobileMode, setMobileMode] = useState(true);
  const [error, setError] = useState<string>();
  const openedRef = useRef(false);

  const rectOf = () => {
    const el = containerRef.current;
    if (!el) return undefined;
    const r = el.getBoundingClientRect();
    return { x: r.left, y: r.top, width: r.width, height: r.height };
  };

  const describeError = (code: unknown) => (isKnownError(code) ? b.errors[code] : String(code));

  const openAt = async (url: string, mobile: boolean) => {
    const rect = rectOf();
    if (!rect) return;
    setError(undefined);
    try {
      const finalUrl = await invoke<string>("browser_open", { url, mobile, ...rect });
      openedRef.current = true;
      setOpenedUrl(finalUrl);
      setAddressInput(finalUrl);
    } catch (e) {
      setError(describeError(e));
    }
  };

  const go = () => {
    if (!addressInput.trim()) {
      setError(b.errors.EMPTY_URL);
      return;
    }
    void openAt(addressInput, mobileMode);
  };

  // Keep the native webview glued to this container whenever it moves or resizes (sidebar
  // toggled, window resized, phone/desktop breakpoint switch).
  useEffect(() => {
    const el = containerRef.current;
    if (!el || !hasTauri()) return;
    const sync = () => {
      if (!openedRef.current) return;
      const rect = rectOf();
      if (rect) void invoke("browser_set_bounds", rect).catch(() => undefined);
    };
    const observer = new ResizeObserver(sync);
    observer.observe(el);
    window.addEventListener("resize", sync);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", sync);
    };
  }, []);

  // Hide (never destroy) the native view when leaving this page; show it again on return.
  useEffect(() => {
    if (!hasTauri()) return;
    const rect = rectOf();
    if (openedRef.current && rect) void invoke("browser_show", rect).catch(() => undefined);
    return () => {
      if (openedRef.current) void invoke("browser_hide").catch(() => undefined);
    };
  }, []);

  useEffect(() => {
    if (!hasTauri()) return;
    let unlisten: (() => void) | undefined;
    void (async () => {
      const { listen } = await import("@tauri-apps/api/event");
      unlisten = await listen<{ url: string }>("browser-tab://navigated", (e) => {
        setOpenedUrl(e.payload.url);
        setAddressInput(e.payload.url);
      });
    })();
    return () => unlisten?.();
  }, []);

  const toggleMobile = async () => {
    const next = !mobileMode;
    setMobileMode(next);
    if (openedRef.current && openedUrl) {
      await invoke("browser_close").catch(() => undefined);
      openedRef.current = false;
      await openAt(openedUrl, next);
    }
  };

  if (!hasTauri()) {
    return (
      <div className="page page--no-inspector">
        <EmptyState title={b.emptyTitle} hint={b.notDesktop} />
      </div>
    );
  }

  return (
    <div className="page page--no-inspector browser">
      <div className="browser__bar">
        <button
          type="button"
          className="icon-btn"
          onClick={() => void invoke("browser_back").catch(() => undefined)}
          disabled={!openedUrl}
          aria-label={b.back}
          title={b.back}
        >
          ‹
        </button>
        <button
          type="button"
          className="icon-btn"
          onClick={() => void invoke("browser_forward").catch(() => undefined)}
          disabled={!openedUrl}
          aria-label={b.forward}
          title={b.forward}
        >
          ›
        </button>
        <button
          type="button"
          className="icon-btn"
          onClick={() => void invoke("browser_reload").catch(() => undefined)}
          disabled={!openedUrl}
          aria-label={b.reload}
          title={b.reload}
        >
          ↻
        </button>
        <input
          className="input browser__address"
          value={addressInput}
          onChange={(e) => setAddressInput(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && go()}
          placeholder={b.addressPlaceholder}
          inputMode="url"
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
        />
        <button type="button" className="btn btn--primary" onClick={go}>
          {b.go}
        </button>
        <label className="browser__mobile">
          <input type="checkbox" checked={mobileMode} onChange={() => void toggleMobile()} />
          {b.mobileMode}
        </label>
      </div>
      {error && (
        <p className="note note--error" role="alert">
          {error}
        </p>
      )}
      <p className="muted browser__hint">{b.mobileModeHint}</p>
      <div className="browser__viewport" ref={containerRef}>
        {!openedUrl && <EmptyState title={b.emptyTitle} hint={b.emptyHint} />}
      </div>
    </div>
  );
}
