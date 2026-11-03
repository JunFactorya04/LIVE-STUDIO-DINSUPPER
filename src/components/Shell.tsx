import { useEffect, useRef, useState, type ReactNode } from "react";
import { isRemote } from "../platform/backend";
import { PHONE_TABS, visibleNav, type PageId } from "../navigation";
import { NavIcon } from "./Icons";
import { useI18n } from "../i18n";
import { useLiveSession } from "../live/useLiveSession";

interface NavProps {
  current: PageId;
  onSelect: (id: PageId) => void;
}

export function Sidebar({ current, onSelect }: NavProps) {
  const { t } = useI18n();
  const live = useLiveSession();
  // Counts on the right of a source-list row: comments of this session, orders to review.
  const counts: Partial<Record<PageId, number>> = {
    console: live.comments.length,
    orders: live.drafts.filter((d) => d.status === "NEEDS_REVIEW").length,
  };
  const sections = [
    { key: "main", title: t.nav.sectionMain },
    { key: "manage", title: t.nav.sectionManage },
  ] as const;

  return (
    <aside className="sidebar" aria-label={t.app.name}>
      <div className="sidebar__brand">{t.app.assistant}</div>
      {sections.map((section) => (
        <div key={section.key}>
          <div className="sidebar__section">{section.title}</div>
          {visibleNav(isRemote())
            .filter((i) => i.section === section.key)
            .map((item) => (
              <button
                key={item.id}
                type="button"
                className="sidebar__item"
                aria-current={current === item.id ? "page" : undefined}
                onClick={() => onSelect(item.id)}
              >
                <NavIcon id={item.id} />
                {t.nav[item.id]}
                {(counts[item.id] ?? 0) > 0 && (
                  <span className="sidebar__count" aria-hidden="true">
                    {counts[item.id]}
                  </span>
                )}
              </button>
            ))}
        </div>
      ))}
    </aside>
  );
}

interface ToolbarProps {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
}

export function Toolbar({ title, subtitle, actions }: ToolbarProps) {
  return (
    <header className="toolbar" data-tauri-drag-region>
      <div className="toolbar__title">
        <strong>{title}</strong>
        {subtitle && <span>{subtitle}</span>}
      </div>
      <div className="toolbar__spacer" />
      {actions}
    </header>
  );
}

export function TabBar({ current, onSelect }: NavProps) {
  const { t } = useI18n();
  const [moreOpen, setMoreOpen] = useState(false);
  const remote = isRemote();
  const nav = visibleNav(remote);
  // A phone (sharing link) gets its own bar with the scan button in the middle.
  const isTab = (id: PageId) =>
    remote ? PHONE_TABS.includes(id) : nav.some((i) => i.id === id && i.tab);
  const tabs = remote
    ? PHONE_TABS.flatMap((id) => nav.filter((i) => i.id === id))
    : nav.filter((i) => i.tab);
  const rest = nav.filter((i) => !isTab(i.id) && !(remote && i.id === "home"));
  const accent: PageId = remote ? "scan" : "pos";
  const moreActive = rest.some((i) => i.id === current);

  // The menu closes whenever the page changes, on Esc, and on a tap anywhere outside it
  // (a tap on the page, another tab) — it never stays hanging over the next screen.
  useEffect(() => setMoreOpen(false), [current]);
  const menuRef = useRef<HTMLDivElement>(null);
  const moreBtn = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!moreOpen) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setMoreOpen(false);
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node;
      if (menuRef.current?.contains(t) || moreBtn.current?.contains(t)) return;
      setMoreOpen(false);
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("pointerdown", onDown, true);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("pointerdown", onDown, true);
    };
  }, [moreOpen]);

  return (
    <nav className="tabbar" aria-label={t.app.name}>
      {moreOpen && (
        <div className="more-menu" role="menu" ref={menuRef}>
          {rest.map((item) => (
            <button
              key={item.id}
              type="button"
              role="menuitem"
              className="more-menu__item"
              aria-current={current === item.id ? "page" : undefined}
              onClick={() => {
                setMoreOpen(false);
                onSelect(item.id);
              }}
            >
              <NavIcon id={item.id} size={20} />
              {t.nav[item.id]}
            </button>
          ))}
        </div>
      )}
      {tabs.map((item) => (
        <button
          key={item.id}
          type="button"
          className={item.id === accent ? "tabbar__item tabbar__item--accent" : "tabbar__item"}
          aria-current={current === item.id ? "page" : undefined}
          onClick={() => {
            setMoreOpen(false);
            onSelect(item.id);
          }}
        >
          <NavIcon id={item.id} size={item.id === accent ? 26 : 22} />
          <span className="tabbar__label">
            {item.id in t.navTab ? t.navTab[item.id as keyof typeof t.navTab] : t.nav[item.id]}
          </span>
        </button>
      ))}
      <button
        type="button"
        className="tabbar__item"
        ref={moreBtn}
        aria-haspopup="menu"
        aria-expanded={moreOpen}
        aria-current={moreActive ? "page" : undefined}
        onClick={() => setMoreOpen((v) => !v)}
      >
        <NavIcon id="more" size={22} />
        {t.nav.more}
      </button>
    </nav>
  );
}
