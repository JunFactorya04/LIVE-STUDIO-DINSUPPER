import { useEffect, useRef, useState } from "react";
import { downscaleImage } from "./downscale";
import type { SkuImageClient } from "./images";

// Shared in-memory cache so every thumbnail for the same SKU on screen (Stock table, POS cart)
// shares one fetch instead of each row calling the backend on its own.
const cache = new Map<string, string | null>();

/** Call after saving a new photo so every thumbnail of that SKU already on screen updates too. */
function setCached(sku: string, url: string | null) {
  cache.set(sku, url);
  for (const fn of listeners.get(sku) ?? []) fn(url);
}
const listeners = new Map<string, Set<(url: string | null) => void>>();

function useSkuImage(sku: string, images: SkuImageClient): string | null | undefined {
  const [url, setUrl] = useState<string | null | undefined>(cache.get(sku));
  useEffect(() => {
    if (!images.available || !sku) return;
    const onChange = (v: string | null) => setUrl(v);
    const set = listeners.get(sku) ?? new Set();
    set.add(onChange);
    listeners.set(sku, set);
    if (cache.has(sku)) {
      setUrl(cache.get(sku));
    } else {
      let alive = true;
      images
        .get(sku)
        .then((v) => {
          const resolved = v ?? null;
          cache.set(sku, resolved);
          if (alive) setUrl(resolved);
        })
        .catch(() => alive && setUrl(null));
      return () => {
        alive = false;
        set.delete(onChange);
      };
    }
    return () => {
      set.delete(onChange);
    };
  }, [sku, images]);
  return url;
}

/** A small product-photo thumbnail for a SKU, or a neutral placeholder when it has none. */
export function SkuThumb({
  sku,
  images,
  size = 36,
}: {
  sku: string;
  images: SkuImageClient;
  size?: number;
}) {
  const url = useSkuImage(sku, images);
  if (!images.available) return null;
  const style = { width: size, height: size };
  if (!url) {
    return <span className="sku-thumb sku-thumb--empty" style={style} aria-hidden="true" />;
  }
  return <img className="sku-thumb" style={style} src={url} alt="" />;
}

/** Camera (phone) or file picker (desktop) to set one SKU's product photo. */
export function SkuPhotoPicker({
  sku,
  images,
  label,
  retakeLabel,
}: {
  sku: string;
  images: SkuImageClient;
  label: string;
  retakeLabel: string;
}) {
  const ref = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const url = useSkuImage(sku, images);

  const pick = async (file: File | undefined) => {
    if (!file || !sku) return;
    setBusy(true);
    try {
      const dataUrl = await downscaleImage(file);
      await images.set(sku, dataUrl);
      setCached(sku, dataUrl);
    } finally {
      setBusy(false);
      if (ref.current) ref.current.value = "";
    }
  };

  if (!images.available) return null;

  return (
    <div className="sku-photo-pick">
      {url ? (
        <img className="sku-photo-pick__preview" src={url} alt="" />
      ) : (
        <span className="sku-thumb sku-thumb--empty" aria-hidden="true" />
      )}
      <input
        ref={ref}
        type="file"
        accept="image/*"
        capture="environment"
        hidden
        onChange={(e) => void pick(e.target.files?.[0])}
      />
      <button
        type="button"
        className="btn"
        disabled={!sku || busy}
        onClick={() => ref.current?.click()}
      >
        {busy ? "…" : url ? retakeLabel : label}
      </button>
    </div>
  );
}
