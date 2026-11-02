import { hasBackend, invoke } from "../platform/backend";

// One photo per SKU (not per unit — every unit of a SKU is the same product), set when stock is
// received, shown again in Stock and in the "Thanh Toán" checkout cart. Stored as a small data:
// URL (see ./downscale.ts), so a phone reading it over the share link gets the same bytes
// through the ordinary JSON command round trip as every other command.

export interface SkuImageClient {
  readonly available: boolean;
  get(sku: string): Promise<string | undefined>;
  set(sku: string, dataUrl: string): Promise<void>;
  remove(sku: string): Promise<void>;
}

class TauriSkuImageClient implements SkuImageClient {
  readonly available = true;
  get = (sku: string) =>
    invoke<string | null>("sku_image_get", { sku }).then((v) => v ?? undefined);
  set = (sku: string, dataUrl: string) =>
    invoke<null>("sku_image_set", { sku, dataUrl, now: new Date().toISOString() }).then(
      () => undefined,
    );
  remove = (sku: string) => invoke<null>("sku_image_delete", { sku }).then(() => undefined);
}

class UnavailableSkuImageClient implements SkuImageClient {
  readonly available = false;
  private no = (): Promise<never> => Promise.reject(new Error("NOT_DESKTOP"));
  get = this.no;
  set = this.no;
  remove = this.no;
}

export const createSkuImageClient = (): SkuImageClient =>
  hasBackend() ? new TauriSkuImageClient() : new UnavailableSkuImageClient();
