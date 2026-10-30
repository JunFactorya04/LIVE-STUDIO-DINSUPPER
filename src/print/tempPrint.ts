import type { LiveCommentEvent } from "../live/types";
import type { OrderDraft } from "../orders/types";
import { createShipClient, type ShipClient } from "../ship/client";
import { getPrintService, type PrintService } from "./service";
import type { TempSlipLabels } from "./slip";
import { draftSeq, loadSticker, stickerData, stickerSlip } from "./sticker";

/**
 * Print the temporary slip of a draft; when it reached the printer, remember that for the buyer
 * so the A-Z routine can show the step as done. Remembering never blocks or fails the print.
 */
export async function printTempSlip(
  draft: OrderDraft,
  comments: readonly LiveCommentEvent[],
  labels: TempSlipLabels,
  deps: { service?: PrintService; ship?: ShipClient; drafts?: readonly OrderDraft[] } = {},
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
  const ok = await (deps.service ?? getPrintService()).print(stickerSlip(loadSticker(), data));
  if (ok && draft.username) {
    try {
      await ship.markFlow(draft.username, "SLIP_PRINTED");
    } catch {
      // not the desktop app, or the buyer id is not a valid TikTok id: nothing to remember
    }
  }
  return ok;
}
