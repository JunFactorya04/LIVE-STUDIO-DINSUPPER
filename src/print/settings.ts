// Network printer settings. The printer's IP address is not a secret, so it lives in
// localStorage next to the other preferences (never the keychain, which is for API keys).

export const PAPER_WIDTHS = [384, 576] as const; // dots: 58 mm and 80 mm paper at 203 dpi
/** Label printers: 40, 48, 50 and 72 mm wide stock at 203 dpi. */
export const LABEL_WIDTHS = [320, 384, 400, 576] as const;
export type PaperWidth = (typeof PAPER_WIDTHS)[number] | (typeof LABEL_WIDTHS)[number];

export interface PrinterSettings {
  host: string;
  port: number;
  widthDots: PaperWidth;
  /** Print a temporary slip when a new order draft appears. Off by default. */
  autoTemp: boolean;
}

export const DEFAULT_PRINTER: PrinterSettings = {
  host: "",
  port: 9100,
  widthDots: 576,
  autoTemp: false,
};

const KEY = "live-studio.printer";
const LABEL_KEY = "live-studio.label-printer";

function load(key: string, widths: readonly number[], fallback: PrinterSettings): PrinterSettings {
  try {
    const raw = JSON.parse(localStorage.getItem(key) ?? "null") as Partial<PrinterSettings> | null;
    if (!raw || typeof raw !== "object") return { ...fallback };
    const port = Number(raw.port);
    return {
      host: typeof raw.host === "string" ? raw.host.trim() : "",
      port: Number.isInteger(port) && port > 0 && port < 65536 ? port : fallback.port,
      widthDots: widths.includes(raw.widthDots as number)
        ? (raw.widthDots as PaperWidth)
        : fallback.widthDots,
      autoTemp: raw.autoTemp === true,
    };
  } catch {
    return { ...fallback };
  }
}

export const loadPrinter = (): PrinterSettings => load(KEY, PAPER_WIDTHS, DEFAULT_PRINTER);

/** The second printer, for barcode labels. Same kind of settings, its own storage and sizes. */
export const DEFAULT_LABEL_PRINTER: PrinterSettings = {
  host: "",
  port: 9100,
  widthDots: 400,
  autoTemp: false,
};
export const loadLabelPrinter = (): PrinterSettings =>
  load(LABEL_KEY, LABEL_WIDTHS, DEFAULT_LABEL_PRINTER);

function save(key: string, s: PrinterSettings): void {
  try {
    localStorage.setItem(key, JSON.stringify(s));
  } catch {
    /* not persisted; applies until the app closes */
  }
}
export const savePrinter = (s: PrinterSettings): void => save(KEY, s);
export const saveLabelPrinter = (s: PrinterSettings): void => save(LABEL_KEY, s);

export const isConfigured = (s: PrinterSettings): boolean => s.host.trim() !== "";
