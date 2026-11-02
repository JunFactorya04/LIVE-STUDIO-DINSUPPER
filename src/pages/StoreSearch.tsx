import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { useI18n } from "../i18n";
import type { ShipClient, StoreHit } from "../ship/client";
import { matchScore, parseStoreQuery } from "../ship/storeQuery";
import { TAIWAN_REGIONS, type TaiwanRegion } from "../ship/taiwanRegions";

// Type-ahead search of 7-ELEVEN stores. Accepts a store number, Chinese, English or pinyin
// (turned into Chinese first, shown as "understood as"), and lists suggestions as you type.

const DELAY_MS = 350;

function Highlight({ text, marks }: { text: string; marks: readonly string[] }) {
  const hit = marks.find((m) => m && text.includes(m));
  if (!hit) return <>{text}</>;
  const i = text.indexOf(hit);
  return (
    <>
      {text.slice(0, i)}
      <mark>{hit}</mark>
      {text.slice(i + hit.length)}
    </>
  );
}

export function StoreSearch({
  api,
  onPick,
}: {
  api: Pick<ShipClient, "searchStores">;
  onPick: (h: StoreHit) => void;
}) {
  const { t, fmt } = useI18n();
  const f = t.ship.form;
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<StoreHit[]>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const [active, setActive] = useState(0);
  const [open, setOpen] = useState(false);
  const [browsing, setBrowsing] = useState(false);
  const [city, setCity] = useState<TaiwanRegion>();
  const listId = useId();
  const inputId = useId();
  const cache = useRef(new Map<string, StoreHit[]>());
  const parsed = parseStoreQuery(query);
  const marks = [...parsed.understood, ...parsed.keys];

  useEffect(() => {
    const p = parseStoreQuery(query);
    if (p.keys.length === 0) {
      setHits(undefined);
      setBusy(false);
      return;
    }
    let live = true;
    const timer = window.setTimeout(async () => {
      setBusy(true);
      setError(false);
      try {
        const lists = await Promise.all(
          p.keys.map(async (k) => {
            const cached = cache.current.get(k);
            if (cached) return cached;
            const r = await api.searchStores(k);
            cache.current.set(k, r);
            return r;
          }),
        );
        if (!live) return;
        const byCode = new Map<string, StoreHit>();
        for (const h of lists.flat()) byCode.set(h.code, h);
        // Stores that match more of the typed pieces first; stores that cannot take parcels last.
        const ranked = [...byCode.values()].sort(
          (a, b) =>
            Number(a.disabled) - Number(b.disabled) ||
            matchScore(p.understood, b.name + b.address) -
              matchScore(p.understood, a.name + a.address),
        );
        setHits(ranked.slice(0, 30));
        setActive(0);
      } catch {
        if (live) {
          setHits(undefined);
          setError(true);
        }
      } finally {
        if (live) setBusy(false);
      }
    }, DELAY_MS);
    return () => {
      live = false;
      window.clearTimeout(timer);
    };
  }, [api, query]);

  const pick = (h: StoreHit) => {
    if (h.disabled) return;
    onPick(h);
    setQuery("");
    setHits(undefined);
    setOpen(false);
  };

  // Clicking a district sends 7-ELEVEN's own city+district text straight into the same free-text
  // search above (parseStoreQuery passes Chinese through unchanged) and opens the result list —
  // picking the live, current entry instead of typing or remembering a store number that may have
  // changed since it was last used.
  const pickDistrict = (c: TaiwanRegion, district: string) => {
    setQuery(c.zh + district);
    setOpen(true);
    setBrowsing(false);
    setCity(undefined);
  };

  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (!hits?.length) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setOpen(true);
      setActive((i) => Math.min(hits.length - 1, i + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => Math.max(0, i - 1));
    } else if (e.key === "Enter" && open) {
      e.preventDefault();
      pick(hits[active]);
    } else if (e.key === "Escape") {
      setOpen(false);
    }
  };

  const showList = open && hits && hits.length > 0;

  return (
    <div className="field store-search">
      <label htmlFor={inputId}>{f.storeSearch}</label>
      <div className="store-search__box">
        <input
          id={inputId}
          className="input"
          role="combobox"
          aria-expanded={Boolean(showList)}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={showList ? `${listId}-${active}` : undefined}
          autoComplete="off"
          spellCheck={false}
          placeholder={f.storePlaceholder}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => window.setTimeout(() => setOpen(false), 150)}
          onKeyDown={onKey}
        />
        {busy && <span className="store-search__spin" aria-label={f.storeSearching} />}
        {showList && (
          <ul id={listId} role="listbox" className="store-search__list">
            {hits.map((h, i) => (
              <li
                key={h.code}
                id={`${listId}-${i}`}
                role="option"
                aria-selected={i === active}
                aria-disabled={h.disabled}
                className={`store-search__item${i === active ? " is-active" : ""}${h.disabled ? " is-off" : ""}`}
                onMouseDown={(e) => e.preventDefault()}
                onMouseEnter={() => setActive(i)}
                onClick={() => pick(h)}
              >
                <span className="store-search__code">{h.code}</span>
                <span className="store-search__text">
                  <strong>
                    <Highlight text={h.name} marks={marks} />
                  </strong>
                  <span className="muted">
                    <Highlight text={h.address} marks={marks} />
                    {h.disabled && ` · ${f.storeDisabled}`}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
      <button
        type="button"
        className="btn store-search__toggle"
        onClick={() => {
          setBrowsing((b) => !b);
          setCity(undefined);
        }}
      >
        {browsing ? f.storeBrowseClose : f.storeBrowse}
      </button>
      {browsing && (
        <div className="store-search__browse">
          {!city ? (
            <>
              <span className="muted">{f.storePickCity}</span>
              <div className="store-search__chips">
                {TAIWAN_REGIONS.map((c) => (
                  <button key={c.zh} type="button" className="btn" onClick={() => setCity(c)}>
                    <span>{c.vi}</span>
                    <span className="store-search__zh">{c.zh}</span>
                  </button>
                ))}
              </div>
            </>
          ) : (
            <>
              <button
                type="button"
                className="store-search__back"
                onClick={() => setCity(undefined)}
              >
                {f.storeBrowseBack}
              </button>
              <span className="muted">
                {fmt(f.storePickDistrict, { city: `${city.vi} ${city.zh}` })}
              </span>
              <div className="store-search__chips">
                {city.districts.map((d) => (
                  <button
                    key={d}
                    type="button"
                    className="btn"
                    onClick={() => pickDistrict(city, d)}
                  >
                    {d}
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
      )}
      {parsed.understood.length > 0 && (
        <span className="muted">
          {f.storeUnderstood}: <strong>{parsed.understood.join(" · ")}</strong>
        </span>
      )}
      {parsed.unknown.length > 0 && (
        <span className="muted">
          {f.storeUnknownWords}: {parsed.unknown.join(", ")}
        </span>
      )}
      {error && (
        <span className="ship__rule ship__rule--bad" role="alert">
          {f.storeOffline}
        </span>
      )}
      {!busy && !error && hits && hits.length === 0 && <span className="muted">{f.storeNone}</span>}
    </div>
  );
}
