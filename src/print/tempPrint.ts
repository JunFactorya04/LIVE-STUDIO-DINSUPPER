import type { LiveCommentEvent } from "../live/types";
import { createOrderRepository, type OrderRepository } from "../orders/repository";
import type { OrderDraft } from "../orders/types";
import { createShipClient, type ShipClient } from "../ship/client";
import { renderSlipPng } from "./raster";
import { getPrintService, type PrintService } from "./service";
import { loadPrinter } from "./settings";
import type { Slip, TempSlipLabels } from "./slip";
import { draftSeq, loadSticker, stickerData, stickerSlip } from "./sticker";

/**
 * Print the temporary slip of a draft; when it reached the printer, remember that for the buyer
 * so the A-Z routine can show the step as done, and keep a PNG of the exact slip on the order so
 * the seller can find and check it after the session ends. Neither remembering step blocks or
 * fails the print itself.
 */
export async function printTempSlip(
  draft: OrderDraft,
  comments: readonly LiveCommentEvent[],
  labels: TempSlipLabels,
  deps: {
    service?: PrintService;
    ship?: ShipClient;
    orders?: OrderRepository;
    drafts?: readonly OrderDraft[];
    renderPng?: (slip: Slip, widthDots: number) => string | undefined;
  } = {},
): Promise<boolean> {
  const ship = deps.ship ?? createShipClient();
  // Name and phone only if the seller already saved this buyer; they are never invented.
  let saved: { name: string; phone: string } | undefined;
  if (draft.username) {
    try {
      const id = draft.username.toLowerCase().replace(/^@/, "");
      saved = (await ship.customers()).find((c) => c.tiktokId === id);
    } catch {
      saved = undefined;
    }
  }
  const data = stickerData(draft, comments, {
    seq: draftSeq(deps.drafts ?? [draft], draft.id),
    unknown: labels.unknown,
    name: saved?.name,
    phone: saved?.phone,
  });
  const slip = stickerSlip(loadSticker(), data);
  const ok = await (deps.service ?? getPrintService()).print(slip);
  if (ok && draft.username) {
    try {
      await ship.markFlow(draft.username, "SLIP_PRINTED");
    } catch {
      // not the desktop app, or the buyer id is not a valid TikTok id: nothing to remember
    }
  }
  if (ok) {
    try {
      const png = (deps.renderPng ?? renderSlipPng)(slip, loadPrinter().widthDots);
      if (png) await (deps.orders ?? createOrderRepository()).saveSlipImage(draft.id, png);
    } catch {
      // Keeping the image is best-effort; a failure here must never look like the print failed.
    }
  }
  return ok;
}
