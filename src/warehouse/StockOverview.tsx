import { useMemo, useState } from "react";
import { useI18n } from "../i18n";
import type { CatalogItem } from "../orders/types";
import type { Unit } from "./client";
import {
  LOW_AT,
  searchStock,
  stockOverview,
  swatchOf,
  variantKey,
  type Hit,
  type Product,
  type StockState,
} from "./overview";
import type { SkuImageClient } from "./images";
import { SkuThumb } from "./SkuPhoto";

// "Tồn kho" at a glance: one card per product with its photo, how many are left, and a small
// colour x size grid of what is on the shelf, so the seller can answer "còn đen size M không?"
// while a customer waits. The search box takes the question as the customer asks it.

const money = (n: number) => `NT$ ${Math.round(n).toLocaleString("en-US")}`;
type Filter = "all" | "LOW" | "OUT";
const TONE: Record<StockState, string> = { OK: "tone-green", LOW: "tone-orange", OUT: "tone-red" };

export function StockOverview({
  shelf,
  catalog,
  images,
}: {
  shelf: readonly Unit[];
  catalog: readonly CatalogItem[];
  images: SkuImageClient;
}) {
  const { t, fmt } = useI18n();
  const o = t.warehouse.overview;
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const products = useMemo(() => stockOverview(shelf, catalog), [shelf, catalog]);
  const hits = useMemo(
    () => searchStock(products, q).filter((h) => filter === "all" || h.product.state === filter),
    [products, q, filter],
  );
  const low = products.filter((p) => p.state === "LOW").length;
  const out = products.filter((p) => p.state === "OUT").length;
  const cost = shelf.reduce((n, u) => n + u.cost, 0);
  const price = shelf.reduce((n, u) => n + u.price, 0);

  return (
    <section className="box stockov" aria-label={o.title}>
      <div className="fin__tiles">
        <div className="fin-tile">
          <span className="fin-tile__label">{t.warehouse.stats.units}</span>
          <strong className="fin-tile__value">{shelf.length}</strong>
          <span className="caption">{fmt(o.productsCount, { n: products.length })}</span>
        </div>
        <div className="fin-tile">
          <span className="fin-tile__label">{t.warehouse.stats.costValue}</span>
          <strong className="fin-tile__value">{money(cost)}</strong>
          <span className="caption">{fmt(o.sellValue, { v: money(price) })}</span>
        </div>
        <button
          type="button"
          className="fin-tile stockov__tile"
          aria-pressed={filter === "LOW"}
          onClick={() => setFilter(filter === "LOW" ? "all" : "LOW")}
        >
          <span className="fin-tile__label">{o.low}</span>
          <strong className="fin-tile__value stockov__low">{low}</strong>
          <span className="caption">{fmt(o.lowHint, { n: LOW_AT })}</span>
        </button>
        <button
          type="button"
          className="fin-tile stockov__tile"
          aria-pressed={filter === "OUT"}
          onClick={() => setFilter(filter === "OUT" ? "all" : "OUT")}
        >
          <span className="fin-tile__label">{o.out}</span>
          <strong className="fin-tile__value stockov__out">{out}</strong>
          <span className="caption">{o.outHint}</span>
        </button>
      </div>

      <div className="stockov__bar">
        <label className="field stockov__search">
          <span className="sr-only">{o.search}</span>
          <input
            className="input"
            type="search"
            value={q}
            placeholder={o.searchPh}
            aria-label={o.search}
            onChange={(e) => setQ(e.target.value)}
          />
        </label>
        <div className="segmented" role="group" aria-label={o.filter}>
          {(["all", "LOW", "OUT"] as const).map((f) => (
            <button key={f} type="button" aria-pressed={filter === f} onClick={() => setFilter(f)}>
              {f === "all" ? o.all : f === "LOW" ? o.low : o.out}
            </button>
          ))}
        </div>
      </div>
      <p className="caption">{o.legend}</p>

      {products.length === 0 ? (
        <div className="empty">
          <strong>{o.emptyTitle}</strong>
          <span className="caption">{o.emptyHint}</span>
        </div>
      ) : hits.length === 0 ? (
        <p className="caption" role="status">
          {fmt(o.none, { q: q.trim() || o.all })}
        </p>
      ) : (
        <ul className="stockov__grid" aria-label={o.title}>
          {hits.map((h) => (
            <li key={h.product.sku}>
              <ProductCard hit={h} images={images} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function ProductCard({ hit, images }: { hit: Hit; images: SkuImageClient }) {
  const { t, fmt } = useI18n();
  const o = t.warehouse.overview;
  const p = hit.product;
  const found = [...hit.variants].reduce((n, k) => n + (p.counts.get(k) ?? 0), 0);
  const plain = p.colors.length === 1 && p.colors[0] === "" && p.sizes.length === 1;
  const priceText =
    p.minPrice === p.maxPrice
      ? p.minPrice
        ? money(p.minPrice)
        : ""
      : `${money(p.minPrice)} – ${money(p.maxPrice)}`;
  return (
    <article className={`stockcard stockcard--${p.state.toLowerCase()}`}>
      <header className="stockcard__head">
        {images.available ? (
          <SkuThumb sku={p.sku} images={images} size={64} />
        ) : (
          <span className="sku-thumb sku-thumb--empty stockcard__nophoto" aria-hidden="true" />
        )}
        <div className="stockcard__id">
          <h3 className="stockcard__name">{p.name || p.sku}</h3>
          <span className="caption">
            {p.name ? p.sku : ""}
            {p.locations.length > 0 && (
              <span className="stockcard__loc">
                {p.name ? ", " : ""}
                {fmt(o.shelf, { loc: p.locations.join(", ") })}
              </span>
            )}
          </span>
          {priceText && <span className="stockcard__price">{priceText}</span>}
        </div>
        <div className="stockcard__count">
          <strong>{p.inStock}</strong>
          <span className={`chip ${TONE[p.state]}`}>
            {p.state === "OUT" ? o.out : p.state === "LOW" ? o.low : o.ok}
          </span>
        </div>
      </header>
      {hit.variants.size > 0 && (
        <p className={`stockcard__found${found === 0 ? " is-none" : ""}`} role="status">
          {found === 0 ? o.foundNone : fmt(o.found, { n: found })}
        </p>
      )}
      {!plain && <VariantGrid p={p} hits={hit.variants} />}
    </article>
  );
}

function VariantGrid({ p, hits }: { p: Product; hits: ReadonlySet<string> }) {
  const { t, fmt } = useI18n();
  const o = t.warehouse.overview;
  const noSizes = p.sizes.length === 1 && p.sizes[0] === "";
  return (
    <div className="vgrid-wrap">
      <table className="vgrid">
        <caption className="sr-only">{fmt(o.gridCaption, { name: p.name || p.sku })}</caption>
        <thead>
          <tr>
            <th scope="col">
              <span className="sr-only">{o.color}</span>
            </th>
            {p.sizes.map((s) => (
              <th scope="col" key={s}>
                {noSizes ? o.qty : s || o.noSize}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {p.colors.map((c) => (
            <tr key={c}>
              <th scope="row">
                <ColorName color={c} fallback={o.noColor} />
              </th>
              {p.sizes.map((s) => {
                const k = variantKey(c, s);
                const n = p.counts.get(k) ?? 0;
                // One left is the one to watch in a single colour/size.
                const state = n === 0 ? "out" : n === 1 ? "low" : "ok";
                const label = fmt(o.cell, {
                  variant: [c || o.noColor, s].filter(Boolean).join(" "),
                  n,
                });
                return (
                  <td
                    key={k}
                    className={`vgrid__cell vgrid__cell--${state}${hits.has(k) ? " is-hit" : ""}`}
                    aria-label={label}
                    title={label}
                  >
                    {n === 0 ? "–" : n}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function ColorName({ color, fallback }: { color: string; fallback: string }) {
  const hex = swatchOf(color);
  return (
    <span className="colorname">
      <span
        className={`swatch${hex ? "" : " swatch--unknown"}${color ? "" : " swatch--none"}`}
        style={hex ? ({ "--swatch": hex } as React.CSSProperties) : undefined}
        aria-hidden="true"
      />
      {color || fallback}
    </span>
  );
}
