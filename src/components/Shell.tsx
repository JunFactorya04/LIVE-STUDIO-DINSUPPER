import { useEffect, useState, type ReactNode } from "react";
import { NAV_ITEMS, type PageId } from "../navigation";
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
          {NAV_ITEMS.filter((i) => i.section === section.key).map((item) => (
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
  const tabs = NAV_ITEMS.filter((i) => i.tab);
  const rest = NAV_ITEMS.filter((i) => !i.tab);
  const moreActive = rest.some((i) => i.id === current);

  useEffect(() => {
    if (!moreOpen) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setMoreOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [moreOpen]);

  return (
    <nav className="tabbar" aria-label={t.app.name}>
      {moreOpen && (
        <div className="more-menu" role="menu">
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
          className="tabbar__item"
          aria-current={current === item.id ? "page" : undefined}
          onClick={() => {
            setMoreOpen(false);
            onSelect(item.id);
          }}
        >
          <NavIcon id={item.id} size={22} />
          {t.nav[item.id]}
        </button>
      ))}
      <button
        type="button"
        className="tabbar__item"
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
