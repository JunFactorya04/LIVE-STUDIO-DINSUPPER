import { useEffect, useId, useState } from "react";
import { EmptyState } from "../components/States";
import { useI18n } from "../i18n";
import { useLiveSession } from "../live/useLiveSession";
import {
  buildPayload,
  createOverlayClient,
  hiddenPayload,
  type OverlayClient,
} from "../overlay/controller";

export function OverlayPage({ client }: { client?: OverlayClient }) {
  const { t } = useI18n();
  const { catalog } = useLiveSession();
  const [overlay] = useState(() => client ?? createOverlayClient());
  const [sku, setSku] = useState("");
  const [priceText, setPriceText] = useState("");
  const [promo, setPromo] = useState("");
  const [live, setLive] = useState(false);
  const [url, setUrl] = useState<string>();
  const [note, setNote] = useState<{ text: string; error: boolean }>();
  const ids = { sku: useId(), price: useId(), promo: useId() };
  const o = t.overlay;
  const item = catalog.find((c) => c.sku === sku);

  useEffect(() => {
    void overlay.url().then(setUrl, () => setUrl(undefined));
  }, [overlay]);

  const pick = (value: string) => {
    setSku(value);
    const next = catalog.find((c) => c.sku === value);
    setPriceText(next?.price === undefined ? "" : `NT$${next.price}`);
    setNote(undefined);
  };

  const push = async (visible: boolean) => {
    try {
      await overlay.set(
        visible && item ? buildPayload(item, priceText, promo, true) : hiddenPayload,
      );
      setLive(visible && Boolean(item));
      setNote({ text: visible ? o.shown : o.hidden, error: false });
    } catch {
      setNote({ text: o.error, error: true });
    }
  };

  const copyUrl = async () => {
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      setNote({ text: o.urlCopied, error: false });
    } catch {
      setNote({ text: o.copyFailed, error: true });
    }
  };

  return (
    <div className="page page--no-inspector orders">
      <section className="box orders__box">
        <p className="banner banner--info" role="note">
          {o.notice}
        </p>
        {catalog.length === 0 ? (
          <EmptyState title={o.emptyTitle} hint={o.emptyHint} />
        ) : (
          <>
            <div className="field">
              <label htmlFor={ids.sku}>{o.product}</label>
              <select
                id={ids.sku}
                className="input"
                value={sku}
                onChange={(e) => pick(e.target.value)}
              >
                <option value="">{o.choose}</option>
                {catalog.map((c) => (
                  <option key={c.sku} value={c.sku}>
                    {c.sku} {c.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label htmlFor={ids.price}>{o.priceText}</label>
              <input
                id={ids.price}
                className="input"
                type="text"
                maxLength={24}
                value={priceText}
                onChange={(e) => setPriceText(e.target.value)}
              />
            </div>
            <div className="field">
              <label htmlFor={ids.promo}>{o.promo}</label>
              <input
                id={ids.promo}
                className="input"
                type="text"
                maxLength={120}
                placeholder={o.promoPlaceholder}
                value={promo}
                onChange={(e) => setPromo(e.target.value)}
              />
            </div>

            <h2 className="section-title">{o.preview}</h2>
            <div className="overlay-preview" aria-label={o.preview}>
              {item ? (
                <>
                  <div className="overlay-preview__name">{item.name}</div>
                  <div className="overlay-preview__sku">{item.sku}</div>
                  {priceText && <div className="overlay-preview__price">{priceText}</div>}
                  <div className="overlay-preview__tags">
                    {[...item.colors, ...item.sizes].map((v) => (
                      <span key={v}>{v.split("|")[0]}</span>
                    ))}
                  </div>
                  {promo && <div className="overlay-preview__promo">{promo}</div>}
                </>
              ) : (
                <span className="muted">{o.choose}</span>
              )}
            </div>

            <div className="actions">
              <span className={`chip ${live ? "tone-green" : "tone-gray"}`}>
                {live ? o.stateShown : o.stateHidden}
              </span>
              <span className="toolbar__spacer" />
              <button
                type="button"
                className="btn btn--primary"
                disabled={!item || !overlay.available}
                onClick={() => void push(true)}
              >
                {live ? o.update : o.show}
              </button>
              <button
                type="button"
                className="btn"
                disabled={!live}
                onClick={() => void push(false)}
              >
                {o.hide}
              </button>
            </div>
          </>
        )}

        <h2 className="section-title">{o.urlTitle}</h2>
        {overlay.available && url ? (
          <div className="actions">
            <code className="mono">{url}</code>
            <button type="button" className="btn" onClick={() => void copyUrl()}>
              {o.copyUrl}
            </button>
          </div>
        ) : (
          <p className="note">{overlay.available ? o.noPort : o.desktopOnly}</p>
        )}
        <p className="caption">{o.help}</p>
        {note && (
          <p className="caption" role={note.error ? "alert" : "status"}>
            {note.text}
          </p>
        )}
      </section>
    </div>
  );
}
