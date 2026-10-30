import type { LiveCommentEvent } from "../live/types";
import type { OrderDraft } from "../orders/types";
import { createShipClient, type ShipClient } from "../ship/client";
import { getPrintService, type PrintService } from "./service";
import { tempSlip, type TempSlipLabels } from "./slip";

/**
 * Print the temporary slip of a draft; when it reached the printer, remember that for the buyer
 * so the A-Z routine can show the step as done. Remembering never blocks or fails the print.
 */
export async function printTempSlip(
  draft: OrderDraft,
  comments: readonly LiveCommentEvent[],
  labels: TempSlipLabels,
  deps: { service?: PrintService; ship?: ShipClient } = {},
): Promise<boolean> {
  const ok = await (deps.service ?? getPrintService()).print(tempSlip(draft, comments, labels));
  if (ok && draft.username) {
    try {
      await (deps.ship ?? createShipClient()).markFlow(draft.username, "SLIP_PRINTED");
    } catch {
      // not the desktop app, or the buyer id is not a valid TikTok id: nothing to remember
    }
  }
  return ok;
}
