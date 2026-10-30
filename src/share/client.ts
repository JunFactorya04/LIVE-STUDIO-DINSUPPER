import { hasBackend, isRemote, invoke } from "../platform/backend";
import { isConfigured, loadLabelPrinter, loadPrinter } from "../print/settings";

// Sharing the app with a phone on the same Wi-Fi. Only the desktop app can start it; the phone
// that opens the link is a client of the same commands (see platform/backend.ts).

export interface ShareInfo {
  running: boolean;
  port: number | null;
  urls: string[];
  /** The same links over HTTPS (the phone camera only works on these). */
  secureUrls?: string[];
  /** iOS profile that installs the computer's certificate authority. */
  profileUrl?: string | null;
  /** The same certificate as a plain file, for Android. */
  certUrl?: string | null;
}

export const NOT_SHARING: ShareInfo = { running: false, port: null, urls: [] };

export interface ShareClient {
  readonly available: boolean;
  status(): Promise<ShareInfo>;
  start(): Promise<ShareInfo>;
  stop(): Promise<ShareInfo>;
  /** Tell the sharing server which printer a phone prints to (the one chosen on this computer). */
  syncPrinter(): Promise<void>;
}

const desktop = (): boolean => hasBackend() && !isRemote();

class TauriShareClient implements ShareClient {
  readonly available = true;
  status = () => invoke<ShareInfo>("share_status");
  start = async () => {
    const info = await invoke<ShareInfo>("share_start");
    await this.syncPrinter();
    return info;
  };
  stop = () => invoke<ShareInfo>("share_stop");
  async syncPrinter(): Promise<void> {
    for (const [kind, p] of [
      ["receipt", loadPrinter()],
      ["label", loadLabelPrinter()],
    ] as const) {
      await invoke("share_set_printer", {
        host: isConfigured(p) ? p.host : "",
        port: p.port,
        widthDots: p.widthDots,
        kind,
      });
    }
  }
}

class UnavailableShareClient implements ShareClient {
  readonly available = false;
  status = async () => NOT_SHARING;
  start = async () => {
    throw "NOT_DESKTOP";
  };
  stop = async () => NOT_SHARING;
  syncPrinter = async () => undefined;
}

export const createShareClient = (): ShareClient =>
  desktop() ? new TauriShareClient() : new UnavailableShareClient();

/** Phone only: take the computer's printers into this browser so Print works with no setup. */
export async function adoptComputerPrinter(): Promise<void> {
  if (!isRemote()) return;
  type Cfg = { host: string; port: number; widthDots: number } | null;
  const { savePrinter, saveLabelPrinter, loadLabelPrinter, LABEL_WIDTHS } =
    await import("../print/settings");
  try {
    const cfg = await invoke<Cfg>("printer_config", { kind: "receipt" });
    const mine = loadPrinter();
    savePrinter({
      ...mine,
      host: cfg?.host ?? "",
      port: cfg?.port ?? mine.port,
      widthDots: cfg?.widthDots === 384 ? 384 : 576,
      autoTemp: false, // the computer prints automatically; the phone never prints on its own
    });
  } catch {
    // no printer yet or the computer is unreachable: Print shows the usual error
  }
  try {
    const cfg = await invoke<Cfg>("printer_config", { kind: "label" });
    const mine = loadLabelPrinter();
    const w = LABEL_WIDTHS.find((x) => x === cfg?.widthDots);
    saveLabelPrinter({
      ...mine,
      host: cfg?.host ?? "",
      port: cfg?.port ?? mine.port,
      widthDots: w ?? mine.widthDots,
      autoTemp: false,
    });
  } catch {
    // same: the label printer is optional
  }
}
