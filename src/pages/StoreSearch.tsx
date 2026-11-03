import { useMemo, useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { useI18n } from "../i18n";
import type { ShipClient, StoreHit } from "../ship/client";
import { guessAddress } from "../ship/storeAddress";
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
  api: Pick<ShipClient, "searchStores"> &
    Partial<Pick<ShipClient, "storesInArea" | "findStores" | "roadsInArea" | "storesByPrefix">>;
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
  // 7-ELEVEN's own search needs a street, landmark or store name — a bare "city + district" text
  // reliably comes back with no match, so a district pick shown as an ordinary empty result reads
  // as broken. This flag swaps in a hint that explains why and what to type next, instead.
  const [fromDistrict, setFromDistrict] = useState(false);
  const listId = useId();
  const inputId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const cache = useRef(new Map<string, StoreHit[]>());
  const parsed = parseStoreQuery(query);
  const marks = [...parsed.understood, ...parsed.keys];
  // Suggestions from the typed address: the districts it names (or, for a city alone, that
  // city's districts) and, once a single district is known, the roads in it.
  const textKey = parsed.keys.find((k) => !/^\d+$/.test(k)) ?? "";
  const guess = useMemo(() => guessAddress(textKey), [textKey]);
  const oneArea = guess.areas.length === 1 ? guess.areas[0] : undefined;
  const areaKey = oneArea ? oneArea.city.zh + oneArea.district : "";
  const [roads, setRoads] = useState<{ key: string; list: string[] }>();
  const roadCache = useRef(new Map<string, string[]>());
  useEffect(() => {
    if (!oneArea || !api.roadsInArea) return;
    const key = areaKey;
    const known = roadCache.current.get(key);
    if (known) return setRoads({ key, list: known });
    let live = true;
    api.roadsInArea(oneArea.city.zh, oneArea.district).then(
      (list) => {
        roadCache.current.set(key, list);
        if (live) setRoads({ key, list });
      },
      () => undefined,
    );
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api, areaKey]);
  const roadChips = useMemo(() => {
    if (!oneArea || roads?.key !== areaKey) return [];
    const typed = guess.road;
    const list = typed ? roads.list.filter((r) => r.includes(typed) && r !== typed) : roads.list;
    return list.slice(0, 12);
  }, [oneArea, roads, areaKey, guess.road]);
  const searchFor = (text: string) => {
    setQuery(text);
    setOpen(true);
    setFromDistrict(false);
    window.requestAnimationFrame(() => inputRef.current?.focus());
  };

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
        const once = async (key: string, get: () => Promise<StoreHit[]>) => {
          const cached = cache.current.get(key);
          if (cached) return cached;
          const r = await get();
          cache.current.set(key, r);
          return r;
        };
        const tasks: Promise<StoreHit[]>[] = [];
        for (const k of p.keys) {
          if (/^\d+$/.test(k)) {
            // The map finds only a complete number; a partial one is looked up among the stores
            // this computer already knows.
            if (k.length >= 6) tasks.push(once(k, () => api.searchStores(k)));
            else if (api.storesByPrefix) tasks.push(once(`p:${k}`, () => api.storesByPrefix!(k)));
            continue;
          }
          tasks.push(once(k, () => api.searchStores(k)));
          if (api.findStores) {
            // Part of a store name, anywhere in Taiwan.
            if (k.length <= 10) tasks.push(once(`n:${k}`, () => api.findStores!({ name: k })));
            // An address: the stores of that district, on that road when one was typed.
            const g = guessAddress(k);
            if (g.areas.length === 1) {
              const [a] = g.areas;
              tasks.push(
                once(`r:${a.city.zh}${a.district}:${g.road}`, () =>
                  api.findStores!({ city: a.city.zh, town: a.district, road: g.road }),
                ),
              );
            }
          }
        }
        const settled = await Promise.allSettled(tasks);
        if (!live) return;
        if (settled.length > 0 && settled.every((r) => r.status === "rejected")) {
          throw new Error("offline");
        }
        const lists = settled.map((r) => (r.status === "fulfilled" ? r.value : []));
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
    setFromDistrict(false);
  };

  // Clicking a district sends 7-ELEVEN's own city+district text straight into the same free-text
  // search above (parseStoreQuery passes Chinese through unchanged) and opens the result list —
  // picking the live, current entry instead of typing or remembering a store number that may have
  // changed since it was last used. 7-ELEVEN's search itself needs more than an administrative
  // area to match anything, so the district name is left selected (not just appended) and the
  // field focused, ready for the seller to type over it with a street or store name.
  // The district's own store list (7-ELEVEN's 依地區查詢), with a filter for a street or name.
  const [area, setArea] = useState<{
    city: TaiwanRegion;
    district: string;
    hits?: StoreHit[];
    failed?: boolean;
  }>();
  const [areaFilter, setAreaFilter] = useState("");
  const openArea = (c: TaiwanRegion, district: string) => {
    setArea({ city: c, district });
    setAreaFilter("");
    api.storesInArea!(c.zh, district).then(
      (hits) => setArea((a) => (a?.district === district ? { ...a, hits } : a)),
      () => setArea((a) => (a?.district === district ? { ...a, failed: true } : a)),
    );
  };
  const areaShown = useMemo(() => {
    const words = areaFilter.trim().toLowerCase().split(/\s+/).filter(Boolean);
    return (area?.hits ?? []).filter((h) =>
      words.every((w) => `${h.code} ${h.name} ${h.address}`.toLowerCase().includes(w)),
    );
  }, [area, areaFilter]);

  const pickDistrict = (c: TaiwanRegion, district: string) => {
    if (api.storesInArea) return openArea(c, district);
    setQuery(c.zh + district);
    setOpen(true);
    setFromDistrict(true);
    setBrowsing(false);
    setCity(undefined);
    window.requestAnimationFrame(() => inputRef.current?.select());
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
          ref={inputRef}
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
            setFromDistrict(false);
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
      {query.trim() !== "" && (guess.areas.length > 0 || guess.city) && (
        <div className="store-search__suggest">
          {guess.areas.length > 0 ? (
            <>
              <span className="muted">{f.storeSuggestAreas}</span>
              <div className="store-search__chips">
                {guess.areas.slice(0, 8).map((a) => (
                  <button
                    key={a.city.zh + a.district}
                    type="button"
                    className="btn"
                    onClick={() => {
                      setBrowsing(true);
                      setCity(a.city);
                      if (api.storesInArea) openArea(a.city, a.district);
                      else pickDistrict(a.city, a.district);
                    }}
                  >
                    {fmt(f.storeSuggestArea, { area: `${a.city.zh}${a.district}` })}
                  </button>
                ))}
              </div>
            </>
          ) : guess.city ? (
            <>
              <span className="muted">
                {fmt(f.storePickDistrict, { city: `${guess.city.vi} ${guess.city.zh}` })}
              </span>
              <div className="store-search__chips">
                {guess.city.districts.map((d) => (
                  <button
                    key={d}
                    type="button"
                    className="btn"
                    onClick={() => searchFor(guess.city!.zh + d)}
                  >
                    {d}
                  </button>
                ))}
              </div>
            </>
          ) : null}
          {oneArea && roadChips.length > 0 && (
            <>
              <span className="muted">
                {fmt(f.storeSuggestRoads, { area: `${oneArea.city.zh}${oneArea.district}` })}
              </span>
              <div className="store-search__chips">
                {roadChips.map((r) => (
                  <button
                    key={r}
                    type="button"
                    className="btn"
                    onClick={() => searchFor(oneArea.city.zh + oneArea.district + r)}
                  >
                    {r}
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
      )}
      <button
        type="button"
        className="btn store-search__toggle"
        onClick={() => {
          setBrowsing((b) => !b);
          setCity(undefined);
          setArea(undefined);
        }}
      >
        {browsing ? f.storeBrowseClose : f.storeBrowse}
      </button>
      {browsing && (
        <div className="store-search__browse">
          {area ? (
            <>
              <button
                type="button"
                className="store-search__back"
                onClick={() => setArea(undefined)}
              >
                {f.storeBrowseBack}
              </button>
              <span className="muted">
                {area.hits
                  ? fmt(f.storeAreaCount, {
                      area: `${area.city.zh}${area.district}`,
                      n: area.hits.length,
                    })
                  : area.failed
                    ? f.storeOffline
                    : f.storeSearching}
              </span>
              {area.hits && area.hits.length > 0 && (
                <>
                  <input
                    className="input"
                    type="search"
                    aria-label={f.storeAreaFilter}
                    placeholder={f.storeAreaFilter}
                    value={areaFilter}
                    onChange={(e) => setAreaFilter(e.target.value)}
                  />
                  <ul className="store-search__area" aria-label={f.storeSearch}>
                    {areaShown.map((h) => (
                      <li key={h.code}>
                        <button
                          type="button"
                          className="store-search__item"
                          onClick={() => {
                            pick(h);
                            setBrowsing(false);
                            setArea(undefined);
                            setCity(undefined);
                          }}
                        >
                          <span className="store-search__code">{h.code}</span>
                          <span className="store-search__text">
                            <strong>{h.name}</strong>
                            <span className="muted">{h.address}</span>
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                  {areaShown.length === 0 && <span className="muted">{f.storeNone}</span>}
                </>
              )}
              {area.hits && area.hits.length === 0 && <span className="muted">{f.storeNone}</span>}
            </>
          ) : !city ? (
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
      {!busy && !error && hits && hits.length === 0 && (
        <span className="muted">{fromDistrict ? f.storeNoneDistrict : f.storeNone}</span>
      )}
    </div>
  );
}
