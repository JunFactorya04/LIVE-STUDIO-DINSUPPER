import { isTauri } from "../live/repository";
import type { PrinterSettings } from "./settings";

// Sends a bitmap page to the network printer through Rust (raw TCP, ESC/POS raster).
// A failure is one of these short codes.

export const PRINT_ERROR_CODES = [
  "BAD_HOST",
  "BAD_SIZE",
  "UNREACHABLE",
  "TIMEOUT",
  "WRITE",
  "NOT_DESKTOP",
  "NOT_CONFIGURED",
  "RENDER",
] as const;
export type PrintErrorCode = (typeof PRINT_ERROR_CODES)[number];

export class PrintError extends Error {
  constructor(readonly code: PrintErrorCode) {
    super(code);
  }
}

export interface Bitmap {
  width: number;
  height: number;
  /** ceil(width / 8) bytes per row, 1 = black, most significant bit first. */
  bits: Uint8Array;
}

export interface PrintClient {
  readonly available: boolean;
  print(settings: PrinterSettings, page: Bitmap): Promise<void>;
  /** Connects without printing. */
  probe(settings: PrinterSettings): Promise<void>;
}

function toError(e: unknown): PrintError {
  const code = typeof e === "string" ? e : (e as { message?: string })?.message;
  return new PrintError(
    (PRINT_ERROR_CODES as readonly string[]).includes(code ?? "")
      ? (code as PrintErrorCode)
      : "UNREACHABLE",
  );
}

class TauriPrintClient implements PrintClient {
  readonly available = true;
  async print(s: PrinterSettings, page: Bitmap): Promise<void> {
    const { invoke } = await import("../platform/backend");
    try {
      await invoke("printer_print", {
        host: s.host.trim(),
        port: s.port,
        width: page.width,
        height: page.height,
        bits: Array.from(page.bits),
      });
    } catch (e) {
      throw toError(e);
    }
  }
  async probe(s: PrinterSettings): Promise<void> {
    const { invoke } = await import("../platform/backend");
    try {
      await invoke("printer_probe", { host: s.host.trim(), port: s.port });
    } catch (e) {
      throw toError(e);
    }
  }
}

export const unavailablePrinter: PrintClient = {
  available: false,
  print: () => Promise.reject(new PrintError("NOT_DESKTOP")),
  probe: () => Promise.reject(new PrintError("NOT_DESKTOP")),
};

export function createPrintClient(): PrintClient {
  return isTauri() ? new TauriPrintClient() : unavailablePrinter;
}
