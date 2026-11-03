import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { useI18n } from "../i18n";
import type { CatalogItem } from "../orders/types";
import { isRemote } from "../platform/backend";
import type { Unit, WarehouseClient } from "../warehouse/client";
import type { SkuImageClient } from "../warehouse/images";
import { fold, searchStock, stockOverview, variantKey, type Product } from "../warehouse/overview";
import type { ScanRelay } from "../warehouse/relay";
import { isUnitCode } from "../warehouse/stats";
import { SkuThumb } from "../warehouse/SkuPhoto";
import { ColorName } from "../warehouse/StockOverview";

// Pick what a ship order sends, straight from what is on the shelf ("Nhập Kho"): type a name,
// colour or size, or scan a label (a USB/Bluetooth scanner, the phone camera, or a phone that
// opened the sharing link sends the code here). Choosing one colour+size is what makes the
// order take exactly those units off the shelf when it is saved.

export interface Picked {
  sku: string;
  color: string;
  size: string;
  /** Name + colour + size, for the order's product text. */
  label: string;
  price: number;
}

const MAX_HITS = 8;
const money = (n: number) => `NT$ ${Math.round(n).toLocaleString("en-US")}`;

export function ProductPicker({
  value,
  catalog,
  warehouse,
  images,
  relay,
  camera,
  onPick,
  onScanMore,
  onClear,
}: {
  value: { sku: string; color: string; size: string };
  catalog: readonly CatalogItem[];
  warehouse: WarehouseClient;
  images: SkuImageClient;
  relay?: ScanRelay;
  camera?: (onScan: (code: string) => void) => React.ReactNode;
  onPick: (p: Picked) => void;
  /** The same colour+size scanned again: one more of it. */
  onScanMore: () => void;
  onClear: () => void;
}) {
  const { t, fmt } = useI18n();
  const p = t.ship.form.picker;
  const [shelf, setShelf] = useState<Unit[]>([]);
  const [q, setQ] = useState("");
  const [note, setNote] = useState<{ text: string; error: boolean }>();

  useEffect(() => {
    if (!warehouse.available) return;
    let live = true;
    warehouse
      .units("IN_STOCK")
      .then((u) => live && setShelf(u))
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [warehouse]);

  const products = useMemo(() => stockOverview(shelf, catalog), [shelf, catalog]);
  const hits = useMemo(
    () => (q.trim() ? searchStock(products, q).slice(0, MAX_HITS) : []),
    [products, q],
  );
  const selected = value.sku ? products.find((x) => x.sku === value.sku) : undefined;

  const choose = useCallback(
    (prod: Product, color: string, size: string) => {
      const prices = shelf
        .filter((u) => u.sku === prod.sku && u.color === color && u.size === size)
        .map((u) => u.price);
      onPick({
        sku: prod.sku,
        color,
        size,
        label: [prod.name || prod.sku, color, size].filter(Boolean).join(" "),
        price: prices.length ? Math.min(...prices) : prod.minPrice,
      });
      setQ("");
      setNote(undefined);
    },
    [shelf, onPick],
  );

  // A scanned label (or a typed sku) — the latest value wins, read through a ref so the phone
  // relay listener below never sees a stale picked value.
  const current = useRef(value);
  current.current = value;
  const scan = useCallback(
    async (raw: string) => {
      const code = raw.trim();
      if (!code) return;
      if (isUnitCode(code) && warehouse.available) {
        const u = await warehouse.unit(code).catch(() => undefined);
        if (!u) return setNote({ text: fmt(p.unknown, { code }), error: true });
        if (u.status !== "IN_STOCK")
          return setNote({ text: fmt(p.notInStock, { code }), error: true });
        const prod = products.find((x) => x.sku === u.sku);
        if (!prod) return setNote({ text: fmt(p.unknown, { code }), error: true });
        const v = current.current;
        if (v.sku === u.sku && v.color === u.color && v.size === u.size) {
          onScanMore();
          return setNote({ text: fmt(p.oneMore, { code }), error: false });
        }
        choose(prod, u.color, u.size);
        return setNote({ text: fmt(p.scanned, { code }), error: false });
      }
      // Not a label: an exact product code picks it when it has a single colour+size.
      const prod = products.find((x) => fold(x.sku) === fold(code));
      const inStock = prod
        ? prod.colors
            .flatMap((c) => prod.sizes.map((s) => [c, s] as const))
            .filter(([c, s]) => (prod.counts.get(variantKey(c, s)) ?? 0) > 0)
        : [];
      if (prod && inStock.length === 1) return choose(prod, inStock[0][0], inStock[0][1]);
      setQ(code);
    },
    [warehouse, products, choose, onScanMore, fmt, p],
  );

  // Computer: a phone on the sharing link ("Quét mã") sends its scans to whatever screen is open.
  // Subscribed once; the latest scan handler is read through a ref.
  const scanRef = useRef(scan);
  scanRef.current = scan;
  useEffect(() => {
    if (!relay || isRemote()) return;
    let off = () => {};
    let alive = true;
    void relay
      .listen((code) => void scanRef.current(code), "ship")
      .then((u) => (alive ? (off = u) : u()));
    return () => {
      alive = false;
      off();
    };
  }, [relay]);

  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== "Enter") return;
    e.preventDefault();
    const text = q.trim();
    if (isUnitCode(text) || products.some((x) => fold(x.sku) === fold(text))) void scan(text);
    else if (hits.length === 1) {
      const [only] = hits;
      const keys = [...only.variants].filter((k) => (only.product.counts.get(k) ?? 0) > 0);
      if (keys.length === 1) {
        const [c, s] = keys[0].split("\u0000");
        choose(only.product, c, s);
      }
    }
  };

  if (selected) {
    const left = selected.counts.get(variantKey(value.color, value.size)) ?? 0;
    return (
      <div className="picker picker--chosen">
        <SkuThumb sku={selected.sku} images={images} size={48} />
        <div className="picker__id">
          <strong>{selected.name || selected.sku}</strong>
          <span className="picker__variant">
            {value.color && <ColorName color={value.color} fallback="" />}
            {value.size && <span className="picker__size">{value.size}</span>}
            <span className="caption">{selected.sku}</span>
          </span>
          <span className={`caption${left === 0 ? " picker__warn" : ""}`}>
            {left === 0 ? p.noneLeft : fmt(p.left, { n: left })}
          </span>
        </div>
        <button type="button" className="btn" onClick={onClear}>
          {p.change}
        </button>
        {note && (
          <p className={`caption picker__note${note.error ? " picker__warn" : ""}`} role="status">
            {note.text}
          </p>
        )}
      </div>
    );
  }

  return (
    <div className="picker">
      <div className="ship__search">
        <input
          className="input"
          type="search"
          aria-label={p.search}
          placeholder={p.searchPh}
          autoComplete="off"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={onKey}
        />
        {camera?.((code) => void scan(code))}
      </div>
      <p className="caption">{p.help}</p>
      {note && (
        <p className={`caption${note.error ? " picker__warn" : ""}`} role="status">
          {note.text}
        </p>
      )}
      {q.trim() !== "" && hits.length === 0 && <p className="caption">{p.none}</p>}
      {hits.length > 0 && (
        <ul className="picker__hits" aria-label={p.results}>
          {hits.map(({ product: prod, variants }) => {
            const all = prod.colors.flatMap((c) => prod.sizes.map((s) => [c, s] as const));
            const shown = all.filter(
              ([c, s]) =>
                (prod.counts.get(variantKey(c, s)) ?? 0) > 0 &&
                (variants.size === 0 || variants.has(variantKey(c, s))),
            );
            return (
              <li key={prod.sku} className="picker__hit">
                <SkuThumb sku={prod.sku} images={images} size={44} />
                <div className="picker__id">
                  <strong>{prod.name || prod.sku}</strong>
                  <span className="caption">
                    {prod.name ? `${prod.sku}, ` : ""}
                    {prod.inStock === 0 ? p.out : fmt(p.left, { n: prod.inStock })}
                    {prod.minPrice > 0 ? `, ${money(prod.minPrice)}` : ""}
                  </span>
                  {shown.length > 0 && (
                    <div className="picker__chips" role="group" aria-label={p.pickVariant}>
                      {shown.map(([c, s]) => {
                        const n = prod.counts.get(variantKey(c, s)) ?? 0;
                        const name = [c, s].filter(Boolean).join(" ") || p.only;
                        return (
                          <button
                            key={variantKey(c, s)}
                            type="button"
                            className="btn picker__chip"
                            aria-label={fmt(p.pickOne, { v: name, n })}
                            onClick={() => choose(prod, c, s)}
                          >
                            {c ? <ColorName color={c} fallback="" /> : null}
                            {s && <span className="picker__size">{s}</span>}
                            {!c && !s && <span>{p.only}</span>}
                            <span className="picker__n">{n}</span>
                          </button>
                        );
                      })}
                    </div>
                  )}
                  {shown.length === 0 && prod.inStock > 0 && (
                    <span className="caption picker__warn">{p.variantOut}</span>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
