import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { splitList } from "../orders/catalogCsv";
import { toggleInList } from "./suggestions";

// A text field with a ▾ button that drops down ready-made choices (the shop's own values and
// common ones). Several can be picked for colours and sizes ("Đen;Trắng"); an attribute takes
// one. Typing stays possible for anything that is not in the list.

export interface ChoiceGroup {
  title?: string;
  values: readonly string[];
}

export function ChoiceField({
  id,
  label,
  value,
  onChange,
  groups,
  multi = false,
  renderChoice,
  placeholder,
  openLabel,
  doneLabel,
}: {
  id?: string;
  label?: string;
  value: string;
  onChange: (v: string) => void;
  groups: readonly ChoiceGroup[];
  multi?: boolean;
  renderChoice?: (v: string) => ReactNode;
  placeholder?: string;
  openLabel: string;
  doneLabel: string;
}) {
  const [open, setOpen] = useState(false);
  const ownId = useId();
  const inputId = id ?? ownId;
  const panelId = `${inputId}-choices`;
  const boxRef = useRef<HTMLDivElement>(null);
  const picked = new Set(splitList(value).map((v) => v.toLowerCase()));
  const shown = groups.filter((g) => g.values.length > 0);

  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => {
      if (!boxRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("pointerdown", away, true);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("pointerdown", away, true);
      document.removeEventListener("keydown", esc);
    };
  }, [open]);

  const pick = (v: string) => {
    if (multi) onChange(toggleInList(value, v));
    else {
      onChange(picked.has(v.toLowerCase()) ? "" : v);
      setOpen(false);
    }
  };

  return (
    <div className={`field choice${label ? "" : " choice--bare"}`} ref={boxRef}>
      {label && <label htmlFor={inputId}>{label}</label>}
      <div className="choice__box">
        <input
          id={inputId}
          className="input"
          type="text"
          autoComplete="off"
          placeholder={placeholder}
          value={value}
          onChange={(e) => onChange(e.target.value)}
        />
        {shown.length > 0 && (
          <button
            type="button"
            className="choice__toggle"
            aria-label={`${openLabel}${label ? `: ${label}` : ""}`}
            aria-expanded={open}
            aria-controls={panelId}
            onClick={() => setOpen((o) => !o)}
          >
            ▾
          </button>
        )}
      </div>
      {open && (
        <div className="choice__panel" id={panelId} role="group" aria-label={label ?? openLabel}>
          {shown.map((g, i) => (
            <div key={g.title ?? i} className="choice__group">
              {g.title && <span className="caption">{g.title}</span>}
              <div className="choice__chips">
                {g.values.map((v) => (
                  <button
                    key={v}
                    type="button"
                    className="choice__chip"
                    aria-pressed={picked.has(v.toLowerCase())}
                    onClick={() => pick(v)}
                  >
                    {renderChoice ? renderChoice(v) : v}
                  </button>
                ))}
              </div>
            </div>
          ))}
          {multi && (
            <div className="choice__foot">
              <button type="button" className="btn btn--primary" onClick={() => setOpen(false)}>
                {doneLabel}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
