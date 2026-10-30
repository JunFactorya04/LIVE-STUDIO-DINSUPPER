// Network printer settings. The printer's IP address is not a secret, so it lives in
// localStorage next to the other preferences (never the keychain, which is for API keys).

export const PAPER_WIDTHS = [384, 576] as const; // dots: 58 mm and 80 mm paper at 203 dpi
export type PaperWidth = (typeof PAPER_WIDTHS)[number];

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

export function loadPrinter(): PrinterSettings {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? "null") as Partial<PrinterSettings> | null;
    if (!raw || typeof raw !== "object") return { ...DEFAULT_PRINTER };
    const port = Number(raw.port);
    return {
      host: typeof raw.host === "string" ? raw.host.trim() : "",
      port: Number.isInteger(port) && port > 0 && port < 65536 ? port : DEFAULT_PRINTER.port,
      widthDots: PAPER_WIDTHS.includes(raw.widthDots as PaperWidth)
        ? (raw.widthDots as PaperWidth)
        : DEFAULT_PRINTER.widthDots,
      autoTemp: raw.autoTemp === true,
    };
  } catch {
    return { ...DEFAULT_PRINTER };
  }
}

export function savePrinter(s: PrinterSettings): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    /* not persisted; applies until the app closes */
  }
}

export const isConfigured = (s: PrinterSettings): boolean => s.host.trim() !== "";
