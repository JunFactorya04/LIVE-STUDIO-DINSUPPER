import type { ReactNode } from "react";
import { NAV_ITEMS, type PageId } from "../navigation";
import { NavIcon } from "./Icons";
import { vi } from "../i18n/vi";

interface SidebarProps {
  current: PageId;
  onSelect: (id: PageId) => void;
}

export function Sidebar({ current, onSelect }: SidebarProps) {
  const main = NAV_ITEMS.filter((i) => i.section === "main");
  const manage = NAV_ITEMS.filter((i) => i.section === "manage");

  return (
    <aside className="sidebar" aria-label={vi.app.name}>
      <div className="sidebar__section">{vi.nav.sectionMain}</div>
      {main.map((item) => (
        <button
          key={item.id}
          type="button"
          className="sidebar__item"
          aria-current={current === item.id ? "page" : undefined}
          onClick={() => onSelect(item.id)}
        >
          <NavIcon id={item.id} />
          {item.label}
        </button>
      ))}
      <div className="sidebar__section">{vi.nav.sectionManage}</div>
      {manage.map((item) => (
        <button
          key={item.id}
          type="button"
          className="sidebar__item"
          aria-current={current === item.id ? "page" : undefined}
          onClick={() => onSelect(item.id)}
        >
          <NavIcon id={item.id} />
          {item.label}
        </button>
      ))}
    </aside>
  );
}

interface ToolbarProps {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
  searchable?: boolean;
}

export function Toolbar({ title, subtitle, actions, searchable = true }: ToolbarProps) {
  return (
    <header className="toolbar" data-tauri-drag-region>
      <div className="toolbar__title">
        <strong>{title}</strong>
        {subtitle && <span>{subtitle}</span>}
      </div>
      <div className="toolbar__spacer" />
      {searchable && <input className="search" type="search" placeholder={vi.common.search} aria-label={vi.common.search} />}
      {actions}
    </header>
  );
}

export function TabBar({ current, onSelect }: SidebarProps) {
  return (
    <nav className="tabbar" aria-label={vi.app.name}>
      {NAV_ITEMS.map((item) => (
        <button
          key={item.id}
          type="button"
          className="tabbar__item"
          aria-current={current === item.id ? "page" : undefined}
          onClick={() => onSelect(item.id)}
        >
          <NavIcon id={item.id} size={20} />
          {item.label}
        </button>
      ))}
    </nav>
  );
}
