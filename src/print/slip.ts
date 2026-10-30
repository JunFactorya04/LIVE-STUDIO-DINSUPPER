import type { LiveCommentEvent } from "../live/types";
import type { OrderDraft } from "../orders/types";

// What goes on a slip, as plain data. Drawing it is raster.ts; sending it is service.ts.

export interface SlipLine {
  text: string;
  size: "sm" | "md" | "lg";
  /** Text height in printer dots; overrides `size` (used by the sticker template). */
  px?: number;
  bold?: boolean;
  align?: "left" | "center";
  /** A thin line is drawn instead of text. */
  rule?: boolean;
}

export interface Slip {
  lines: SlipLine[];
}

export interface TempSlipLabels {
  title: string;
  note: string;
  user: string;
  time: string;
  comment: string;
  product: string;
  auto: string;
  unknown: string;
}

const pad = (n: number) => String(n).padStart(2, "0");

export function clock(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return `${pad(d.getMonth() + 1)}/${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/**
 * Temporary slip for a new order draft: the buyer's TikTok id and what they wrote, clearly
 * marked as NOT confirmed. The product line is what the parser guessed, so it is labelled as such.
 * No name, phone or address appears: the app never has them at this point.
 */
export function tempSlip(
  draft: OrderDraft,
  comments: readonly LiveCommentEvent[],
  l: TempSlipLabels,
): Slip {
  const byId = new Map(comments.map((c) => [c.eventId, c]));
  const quotes = [...new Set(draft.evidence.map((e) => e.eventId))]
    .map((id) => byId.get(id))
    .filter((c): c is LiveCommentEvent => Boolean(c));
  const when = quotes[0]?.commentTimestamp ?? draft.createdAt;
  const variant = [draft.color, draft.size].filter(Boolean).join(" / ");
  const product = draft.sku
    ? [draft.sku, variant, draft.quantity ? `x${draft.quantity}` : ""].filter(Boolean).join("  ")
    : l.unknown;

  const lines: SlipLine[] = [
    { text: l.title, size: "lg", bold: true, align: "center" },
    { text: l.note, size: "md", bold: true, align: "center" },
    { text: "", size: "sm", rule: true },
    { text: `${l.user}: ${draft.username ?? "-"}`, size: "lg", bold: true },
    { text: `${l.time}: ${clock(when)}`, size: "md" },
    { text: "", size: "sm", rule: true },
    { text: `${l.comment}:`, size: "sm" },
  ];
  for (const q of quotes) lines.push({ text: q.commentText, size: "md" });
  lines.push({ text: "", size: "sm", rule: true });
  lines.push({ text: `${l.product} ${l.auto}`, size: "sm" });
  lines.push({ text: product, size: "md", bold: true });
  return { lines };
}

export function testSlip(title: string, body: string): Slip {
  return {
    lines: [
      { text: title, size: "lg", bold: true, align: "center" },
      { text: "", size: "sm", rule: true },
      { text: body, size: "md", align: "center" },
    ],
  };
}
