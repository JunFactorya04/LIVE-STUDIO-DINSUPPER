import {
  PrintError,
  createPrintClient,
  type Bitmap,
  type PrintClient,
  type PrintErrorCode,
} from "./client";
import { renderSlip } from "./raster";
import { isConfigured, loadLabelPrinter, loadPrinter, type PrinterSettings } from "./settings";
import type { Slip } from "./slip";

// One queue for all printing: slips go out one at a time, and the outcome is kept so the
// seller can see a failure instead of it being swallowed.

export interface PrintStatus {
  printing: boolean;
  /** Slips waiting, including the one being printed. */
  pending: number;
  error: PrintErrorCode | undefined;
  printed: number;
}

export interface PrintDeps {
  client?: PrintClient;
  loadSettings?: () => PrinterSettings;
  render?: (slip: Slip, width: number) => Bitmap;
}

export class PrintService {
  private status: PrintStatus = { printing: false, pending: 0, error: undefined, printed: 0 };
  private listeners = new Set<() => void>();
  private tail: Promise<void> = Promise.resolve();
  private readonly client: PrintClient;

  constructor(private readonly deps: PrintDeps = {}) {
    this.client = deps.client ?? createPrintClient();
  }

  get available(): boolean {
    return this.client.available;
  }

  subscribe = (l: () => void): (() => void) => {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  };
  getSnapshot = (): PrintStatus => this.status;

  private set(patch: Partial<PrintStatus>): void {
    this.status = { ...this.status, ...patch };
    this.listeners.forEach((l) => l());
  }

  /** Queue a slip. Resolves true when it reached the printer, false when it failed (see status.error). */
  print(slip: Slip): Promise<boolean> {
    this.set({ pending: this.status.pending + 1, error: undefined });
    const job = this.tail.then(() => this.run(slip));
    this.tail = job.then(
      () => undefined,
      () => undefined,
    );
    return job;
  }

  private async run(slip: Slip): Promise<boolean> {
    this.set({ printing: true });
    try {
      const settings = (this.deps.loadSettings ?? loadPrinter)();
      if (!isConfigured(settings)) throw new PrintError("NOT_CONFIGURED");
      const page = (this.deps.render ?? renderSlip)(slip, settings.widthDots);
      await this.client.print(settings, page);
      this.set({ printed: this.status.printed + 1 });
      return true;
    } catch (e) {
      this.set({ error: e instanceof PrintError ? e.code : "RENDER" });
      return false;
    } finally {
      this.set({ printing: false, pending: Math.max(0, this.status.pending - 1) });
    }
  }

  /** Connect to the printer without printing; resolves with the error code or undefined when reachable. */
  async probe(settings: PrinterSettings): Promise<PrintErrorCode | undefined> {
    if (!isConfigured(settings)) return "NOT_CONFIGURED";
    try {
      await this.client.probe(settings);
      return undefined;
    } catch (e) {
      return e instanceof PrintError ? e.code : "UNREACHABLE";
    }
  }
}

let shared: PrintService | undefined;
export const getPrintService = (): PrintService => (shared ??= new PrintService());

let sharedLabel: PrintService | undefined;
/** The second printer (barcode labels): same queue and error handling, its own settings. */
export const getLabelService = (): PrintService =>
  (sharedLabel ??= new PrintService({ loadSettings: loadLabelPrinter }));
