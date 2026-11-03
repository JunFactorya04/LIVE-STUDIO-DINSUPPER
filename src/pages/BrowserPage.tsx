import { useCallback, useEffect, useRef, useState } from "react";
import {
  TIKTOK_LOGIN_URL,
  onBrowserRequest,
  takeBrowserRequest,
  type BrowserRequest,
} from "../browser/route";
import { CARRIERS } from "../carriers/registry";
import { EmptyState } from "../components/States";
import type { PageId } from "../navigation";
import { hasTauri, invoke } from "../platform/backend";
import { useI18n } from "../i18n";

// A manual, view-only browser tab: an address bar, back/forward/reload, and a mobile-mode
// toggle. Nothing here reads, clicks or fills the page on the seller's behalf — the native
// webview is a real browser the seller drives themselves, exactly like opening a new tab. It
// never persists its own session/profile beyond whatever the OS webview keeps by default, and
// it is never reachable from MCP or any other outside channel — only the buttons below call it,
// each wired to the seller's own click.

type BrowserErrorCode =
  | "EMPTY_URL"
  | "BAD_URL"
  | "BAD_SCHEME"
  | "NOT_OPEN"
  | "NO_MAIN_WINDOW"
  | "NOT_FOUND"
  | "OPEN_FAILED";

const BROWSER_ERROR_CODES: readonly BrowserErrorCode[] = [
  "EMPTY_URL",
  "BAD_URL",
  "BAD_SCHEME",
  "NOT_OPEN",
  "NO_MAIN_WINDOW",
  "NOT_FOUND",
  "OPEN_FAILED",
];

function isKnownError(x: unknown): x is BrowserErrorCode {
  return typeof x === "string" && (BROWSER_ERROR_CODES as readonly string[]).includes(x);
}

// The native webview outlives this page (it is only hidden when the seller switches tabs), so
// what it shows is remembered here, not in component state that a remount would reset.
const session: { opened: boolean; url?: string; mobile: boolean; from?: PageId } = {
  opened: false,
  mobile: true,
};

type Download = { name: string; path: string; done: boolean; ok: boolean };

export function BrowserPage({ onNavigate }: { onNavigate?: (page: PageId) => void } = {}) {
  const { t, locale } = useI18n();
  const b = t.browser;
  const containerRef = useRef<HTMLDivElement>(null);
  const [addressInput, setAddressInput] = useState(session.url ?? "");
  const [openedUrl, setOpenedUrl] = useState<string | undefined>(session.url);
  const [mobileMode, setMobileMode] = useState(session.mobile);
  const [from, setFrom] = useState<PageId | undefined>(session.from);
  const [error, setError] = useState<string>();
  const [download, setDownload] = useState<Download>();
  const openedRef = useRef(session.opened);

  const rectOf = () => {
    const el = containerRef.current;
    if (!el) return undefined;
    const r = el.getBoundingClientRect();
    return { x: r.left, y: r.top, width: r.width, height: r.height };
  };

  const describeError = (code: unknown) => (isKnownError(code) ? b.errors[code] : String(code));

  const openAt = useCallback(async (url: string, mobile: boolean) => {
    const rect = rectOf();
    if (!rect) return;
    setError(undefined);
    try {
      // The phone/desktop layout is fixed when the webview is made: switching it means a new one.
      if (openedRef.current && mobile !== session.mobile) {
        await invoke("browser_close").catch(() => undefined);
        openedRef.current = false;
      }
      const finalUrl = await invoke<string>("browser_open", { url, mobile, ...rect });
      openedRef.current = true;
      Object.assign(session, { opened: true, url: finalUrl, mobile });
      setMobileMode(mobile);
      setOpenedUrl(finalUrl);
      setAddressInput(finalUrl);
    } catch (e) {
      setError(describeError(e));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // A carrier or TikTok button elsewhere in the app asked for a page: open it here.
  useEffect(() => {
    if (!hasTauri()) return;
    const load = (r: BrowserRequest) => {
      takeBrowserRequest();
      session.from = r.from;
      setFrom(r.from);
      void openAt(r.url, r.mobile);
    };
    const first = takeBrowserRequest();
    if (first) load(first);
    return onBrowserRequest(load);
  }, [openAt]);

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
      const offNav = await listen<{ url: string }>("browser-tab://navigated", (e) => {
        session.url = e.payload.url;
        setOpenedUrl(e.payload.url);
        setAddressInput(e.payload.url);
      });
      const offDl = await listen<Download>("browser-tab://download", (e) => setDownload(e.payload));
      unlisten = () => {
        offNav();
        offDl();
      };
    })();
    return () => unlisten?.();
  }, []);

  const tool = (cmd: string, args?: Record<string, unknown>) =>
    void invoke(cmd, args).catch((e) => setError(describeError(e)));

  const toggleMobile = async () => {
    const next = !mobileMode;
    setMobileMode(next);
    if (openedRef.current && openedUrl) await openAt(openedUrl, next);
    else session.mobile = next;
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
      <div className="browser__shortcuts" role="group" aria-label={b.shortcuts}>
        {from && onNavigate && (
          <button type="button" className="btn browser__return" onClick={() => onNavigate(from)}>
            ‹ {t.nav[from]}
          </button>
        )}
        {CARRIERS.map((c) => (
          <button
            key={c.id}
            type="button"
            className="btn btn--chip"
            onClick={() => void openAt(c.consoleUrl, false)}
          >
            {locale === "vi" ? c.vi : c.zh}
          </button>
        ))}
        <button
          type="button"
          className="btn btn--chip"
          onClick={() => void openAt(TIKTOK_LOGIN_URL, true)}
        >
          {b.tiktokLogin}
        </button>
      </div>
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
        <button
          type="button"
          className="btn"
          disabled={!openedUrl}
          onClick={() => tool("browser_print")}
        >
          {b.print}
        </button>
        <button
          type="button"
          className="btn"
          disabled={!openedUrl}
          onClick={() => openedUrl && tool("browser_open_external", { url: openedUrl })}
        >
          {b.external}
        </button>
      </div>
      {download && (
        <p className={`note${download.done && !download.ok ? " note--error" : ""}`} role="status">
          {!download.done
            ? b.downloading.replace("{name}", download.name)
            : download.ok
              ? b.downloaded.replace("{name}", download.name)
              : b.downloadFail.replace("{name}", download.name)}{" "}
          {download.done && download.ok && (
            <button
              type="button"
              className="btn"
              onClick={() => tool("browser_reveal_download", { path: download.path })}
            >
              {b.showFile}
            </button>
          )}
        </p>
      )}
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
