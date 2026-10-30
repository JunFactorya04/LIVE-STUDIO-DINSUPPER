import { isTauri } from "../live/repository";
import type { CatalogItem } from "../orders/types";

// The overlay is a local web page (served by Rust on 127.0.0.1) that an OBS-style Browser Source
// can show. It can only ever contain the product fields below, chosen by the seller. It has no
// access to comments or usernames, so no personal data can appear on it.

export interface OverlayPayload {
  visible: boolean;
  name: string;
  sku: string;
  priceText: string;
  colors: string[];
  sizes: string[];
  promo: string;
}

export interface OverlayClient {
  readonly available: boolean;
  set(payload: OverlayPayload): Promise<void>;
  url(): Promise<string | undefined>;
}

export const tauriOverlay: OverlayClient = {
  available: true,
  async set(overlay) {
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke("overlay_set", { overlay });
  },
  async url() {
    const { invoke } = await import("@tauri-apps/api/core");
    const info = await invoke<{ url?: string | null }>("overlay_info");
    return info.url ?? undefined;
  },
};

export const unavailableOverlay: OverlayClient = {
  available: false,
  set: async () => undefined,
  url: async () => undefined,
};

export const createOverlayClient = (): OverlayClient =>
  isTauri() ? tauriOverlay : unavailableOverlay;

const canonical = (entry: string): string => entry.split("|")[0]?.trim() ?? entry;

export function buildPayload(
  item: CatalogItem,
  priceText: string,
  promo: string,
  visible: boolean,
): OverlayPayload {
  return {
    visible,
    name: item.name,
    sku: item.sku,
    priceText,
    colors: item.colors.map(canonical),
    sizes: item.sizes.map(canonical),
    promo,
  };
}

export const hiddenPayload: OverlayPayload = {
  visible: false,
  name: "",
  sku: "",
  priceText: "",
  colors: [],
  sizes: [],
  promo: "",
};
