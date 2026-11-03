import { useId, useState } from "react";
import { EmptyState } from "../components/States";
import { useI18n } from "../i18n";
import { useLiveSession, useLiveStore } from "../live/useLiveSession";
import { parseCatalogCsv, splitList } from "../orders/catalogCsv";
import { INDUSTRIES, presetFields, type Industry } from "../catalog/industryPresets";
import { ChoiceField } from "../catalog/ChoiceField";
import { SIZE_GROUPS, attrChoices, colorChoices, ownSizes } from "../catalog/suggestions";
import { ColorName } from "./StockOverview";
import type { CatalogItem } from "../orders/types";

// "Nhập Kho -> Sản phẩm": the product list (name, price, colours, sizes, the other names
// customers use). The live comment reader matches orders against it, and the stock overview
// shows its names. Moved here from the Orders page so every product fact lives in one tab;
// receiving stock also adds the product (and its colour and size) to this list.

const EMPTY_FORM = { sku: "", name: "", price: "", colors: "", sizes: "", aliases: "" };
type AttrRow = { key: string; value: string };

export function ProductsTab() {
  const { t, fmt, locale } = useI18n();
  const store = useLiveStore();
  const { catalog } = useLiveSession();
  const [form, setForm] = useState(EMPTY_FORM);
  const [attrs, setAttrs] = useState<AttrRow[]>([]);
  const [error, setError] = useState<string>();
  const [csv, setCsv] = useState("");
  const [result, setResult] = useState<string>();
  const ids = {
    sku: useId(),
    name: useId(),
    price: useId(),
    colors: useId(),
    sizes: useId(),
    aliases: useId(),
    csv: useId(),
  };
  const c = t.orders.catalog;

  const save = () => {
    const sku = form.sku.trim();
    const name = form.name.trim();
    if (!sku || !name) return setError(c.skuRequired);
    const price = form.price.trim() === "" ? undefined : Number(form.price.replace(/[^\d.]/g, ""));
    if (price !== undefined && !Number.isFinite(price)) return setError(c.priceInvalid);
    const cleanAttrs: Record<string, string> = {};
    for (const row of attrs) {
      const k = row.key.trim();
      if (k) cleanAttrs[k] = row.value.trim();
    }
    store.saveCatalogItem({
      sku,
      name,
      price,
      colors: splitList(form.colors),
      sizes: splitList(form.sizes),
      aliases: splitList(form.aliases),
      attrs: cleanAttrs,
    });
    setForm(EMPTY_FORM);
    setAttrs([]);
    setError(undefined);
  };

  const edit = (item: CatalogItem) => {
    setForm({
      sku: item.sku,
      name: item.name,
      price: item.price?.toString() ?? "",
      colors: item.colors.join(";"),
      sizes: item.sizes.join(";"),
      aliases: item.aliases.join(";"),
    });
    setAttrs(Object.entries(item.attrs ?? {}).map(([key, value]) => ({ key, value })));
  };

  const addAttrRow = () => setAttrs((rows) => [...rows, { key: "", value: "" }]);
  const removeAttrRow = (i: number) => setAttrs((rows) => rows.filter((_, idx) => idx !== i));
  const updateAttrRow = (i: number, patch: Partial<AttrRow>) =>
    setAttrs((rows) => rows.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  const applyPreset = (industry: Industry) => {
    const existing = new Set(attrs.map((r) => r.key.trim().toLowerCase()).filter(Boolean));
    const add = presetFields(locale, industry)
      .filter((name) => !existing.has(name.toLowerCase()))
      .map((name) => ({ key: name, value: "" }));
    if (add.length > 0) setAttrs((rows) => [...rows, ...add]);
  };

  const importCsv = () => {
    const { items, errors } = parseCatalogCsv(csv);
    if (items.length > 0) store.importCatalog(items);
    setResult(fmt(c.importResult, { n: items.length, bad: errors.length }));
    if (errors.length === 0) setCsv("");
  };

  const field = (key: keyof typeof EMPTY_FORM, label: string) => (
    <div className="field">
      <label htmlFor={ids[key]}>{label}</label>
      <input
        id={ids[key]}
        className="input"
        type="text"
        autoComplete="off"
        value={form[key]}
        onChange={(e) => setForm({ ...form, [key]: e.target.value })}
      />
    </div>
  );

  return (
    <>
      <p className="caption">{c.help}</p>
      <div className="catalog-form">
        {field("sku", c.sku)}
        {field("name", c.name)}
        {field("price", c.price)}
        <ChoiceField
          id={ids.colors}
          label={c.colors}
          value={form.colors}
          onChange={(v) => setForm((f) => ({ ...f, colors: v }))}
          groups={[{ values: colorChoices(locale, catalog) }]}
          multi
          renderChoice={(v) => <ColorName color={v} fallback={v} />}
          openLabel={c.choose}
          doneLabel={c.chooseDone}
        />
        <ChoiceField
          id={ids.sizes}
          label={c.sizes}
          value={form.sizes}
          onChange={(v) => setForm((f) => ({ ...f, sizes: v }))}
          groups={[
            ...SIZE_GROUPS.map((g) => ({ title: c.sizeGroups[g.id], values: g.values })),
            { title: c.sizeGroups.own, values: ownSizes(catalog) },
          ]}
          multi
          openLabel={c.choose}
          doneLabel={c.chooseDone}
        />
        {field("aliases", c.aliases)}
      </div>

      <div className="catalog-attrs">
        <h3>{c.attrsTitle}</h3>
        <p className="caption">{c.attrsHelp}</p>
        <div className="actions">
          {INDUSTRIES.map((industry) => (
            <button
              key={industry}
              type="button"
              className="btn"
              onClick={() => applyPreset(industry)}
            >
              {c.presetLabels[industry]}
            </button>
          ))}
        </div>
        {attrs.length > 0 && (
          <div className="catalog-attrs__rows">
            {attrs.map((row, i) => (
              <div className="catalog-attrs__row" key={i}>
                <input
                  className="input"
                  type="text"
                  autoComplete="off"
                  placeholder={c.attrsKeyPh}
                  value={row.key}
                  onChange={(e) => updateAttrRow(i, { key: e.target.value })}
                />
                <ChoiceField
                  value={row.value}
                  placeholder={c.attrsValuePh}
                  onChange={(v) => updateAttrRow(i, { value: v })}
                  groups={[{ values: attrChoices(row.key, locale, catalog) }]}
                  openLabel={`${c.choose} ${row.key}`.trim()}
                  doneLabel={c.chooseDone}
                />
                <button
                  type="button"
                  className="btn"
                  aria-label={c.attrsRemove}
                  onClick={() => removeAttrRow(i)}
                >
                  {c.attrsRemove}
                </button>
              </div>
            ))}
          </div>
        )}
        <div className="actions">
          <button type="button" className="btn" onClick={addAttrRow}>
            {c.attrsAdd}
          </button>
        </div>
      </div>

      {error && (
        <p className="banner banner--error" role="alert">
          {error}
        </p>
      )}
      <div className="actions">
        <button type="button" className="btn btn--primary" onClick={save}>
          {c.save}
        </button>
      </div>

      {catalog.length === 0 ? (
        <EmptyState title={c.emptyTitle} hint={c.emptyHint} />
      ) : (
        <div className="feed-scroll">
          <table className="table orders-table" aria-label={c.title}>
            <thead>
              <tr>
                <th scope="col">{c.sku}</th>
                <th scope="col">{c.name}</th>
                <th scope="col">{c.price}</th>
                <th scope="col">{c.colors}</th>
                <th scope="col">{c.sizes}</th>
                <th scope="col">{c.aliases}</th>
                <th scope="col">{c.attrsTitle}</th>
                <th scope="col">{t.orders.columns.actions}</th>
              </tr>
            </thead>
            <tbody>
              {catalog.map((item) => (
                <tr key={item.sku}>
                  <td data-label={c.sku}>
                    <strong>{item.sku}</strong>
                  </td>
                  <td className="wrap" data-label={c.name}>
                    {item.name}
                  </td>
                  <td className="num" data-label={c.price}>
                    {item.price ?? t.common.none}
                  </td>
                  <td className="wrap" data-label={c.colors}>
                    {item.colors.join("、") || t.common.none}
                  </td>
                  <td className="wrap" data-label={c.sizes}>
                    {item.sizes.join("、") || t.common.none}
                  </td>
                  <td className="wrap" data-label={c.aliases}>
                    {item.aliases.join("、") || t.common.none}
                  </td>
                  <td className="wrap" data-label={c.attrsTitle}>
                    {Object.entries(item.attrs ?? {})
                      .filter(([, v]) => v)
                      .map(([k, v]) => `${k}: ${v}`)
                      .join("、") || t.common.none}
                  </td>
                  <td className="cell-actions nowrap">
                    <button
                      type="button"
                      className="btn"
                      aria-label={`${c.edit} ${item.sku}`}
                      onClick={() => edit(item)}
                    >
                      {c.edit}
                    </button>{" "}
                    <button
                      type="button"
                      className="btn"
                      aria-label={`${c.remove} ${item.sku}`}
                      onClick={() => store.deleteCatalogItem(item.sku)}
                    >
                      {c.remove}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="paste">
        <label htmlFor={ids.csv} className="paste__label">
          {c.importTitle}
        </label>
        <textarea
          id={ids.csv}
          className="input input--area"
          rows={4}
          spellCheck={false}
          placeholder={c.importPlaceholder}
          value={csv}
          onChange={(e) => setCsv(e.target.value)}
        />
        <p className="caption">{c.importHelp}</p>
        <div className="actions">
          <button type="button" className="btn" disabled={csv.trim() === ""} onClick={importCsv}>
            {c.importButton}
          </button>
        </div>
        {result && (
          <p className="caption" role="status">
            {result}
          </p>
        )}
      </div>
    </>
  );
}
