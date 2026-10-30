import type { LiveCommentEvent } from "../live/types";
import type { OrderDraft } from "../orders/types";
import { clock, type Slip, type SlipLine } from "./slip";

// The sticker ("tem") stuck on a product while the seller is live: order number, time, what the
// buyer wrote, their TikTok id and, only when the seller already saved them, name and phone.
// Each line can be switched off and sized in printer dots; the settings page shows a preview.

export const STICKER_FIELDS = [
  "seq",
  "time",
  "comment",
  "product",
  "tiktok",
  "name",
  "phone",
  "note",
] as const;
export type StickerField = (typeof STICKER_FIELDS)[number];

export interface StickerLine {
  show: boolean;
  /** Text height in printer dots (203 dpi: 8 dots = 1 mm). */
  px: number;
}

export interface StickerTemplate {
  fields: Record<StickerField, StickerLine>;
  /** Fixed text printed on the last line (for example the shop name). Empty = no line. */
  noteText: string;
}

export const PX_MIN = 14;
export const PX_MAX = 72;

export const DEFAULT_STICKER: StickerTemplate = {
  fields: {
    seq: { show: true, px: 36 },
    time: { show: true, px: 24 },
    comment: { show: true, px: 30 },
    product: { show: false, px: 28 },
    tiktok: { show: true, px: 41 },
    name: { show: true, px: 58 },
    phone: { show: true, px: 20 },
    note: { show: true, px: 25 },
  },
  noteText: "",
};

const KEY = "live-studio.sticker";

const clampPx = (n: unknown, fallback: number): number => {
  const v = Math.round(Number(n));
  return Number.isFinite(v) ? Math.min(PX_MAX, Math.max(PX_MIN, v)) : fallback;
};

export function loadSticker(): StickerTemplate {
  const base: StickerTemplate = JSON.parse(JSON.stringify(DEFAULT_STICKER));
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? "null") as Partial<StickerTemplate> | null;
    if (!raw || typeof raw !== "object") return base;
    for (const f of STICKER_FIELDS) {
      const r = raw.fields?.[f];
      if (r) {
        base.fields[f] = {
          show: r.show !== false,
          px: clampPx(r.px, DEFAULT_STICKER.fields[f].px),
        };
      }
    }
    if (typeof raw.noteText === "string") base.noteText = raw.noteText.slice(0, 60);
  } catch {
    /* unreadable: defaults */
  }
  return base;
}

export function saveSticker(t: StickerTemplate): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(t));
  } catch {
    /* applies until the app closes */
  }
}

export interface StickerData {
  seq: number;
  time: string;
  comment: string;
  product: string;
  tiktok: string;
  name: string;
  phone: string;
}

/** Order number inside the session: 1 for the first draft created. */
export function draftSeq(drafts: readonly OrderDraft[], id: string): number {
  const sorted = [...drafts].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const i = sorted.findIndex((d) => d.id === id);
  return i < 0 ? sorted.length + 1 : i + 1;
}

/** The values a sticker shows for a draft. Name and phone are only ever ones the seller saved. */
export function stickerData(
  draft: OrderDraft,
  comments: readonly LiveCommentEvent[],
  opts: { seq: number; unknown: string; name?: string; phone?: string },
): StickerData {
  const byId = new Map(comments.map((c) => [c.eventId, c]));
  const quotes = [...new Set(draft.evidence.map((e) => e.eventId))]
    .map((id) => byId.get(id))
    .filter((c): c is LiveCommentEvent => Boolean(c));
  const variant = [draft.color, draft.size].filter(Boolean).join(" / ");
  return {
    seq: opts.seq,
    time: clock(quotes[0]?.commentTimestamp ?? draft.createdAt),
    comment: quotes.map((q) => q.commentText).join(" | "),
    product: draft.sku
      ? [draft.sku, variant, draft.quantity ? `x${draft.quantity}` : ""].filter(Boolean).join(" ")
      : opts.unknown,
    tiktok: draft.username ? `@${draft.username}` : "-",
    name: opts.name ?? "",
    phone: opts.phone ?? "",
  };
}

/** Lines of the sticker, centred, skipping switched-off and empty ones. */
export function stickerLines(t: StickerTemplate, d: StickerData): SlipLine[] {
  const value: Record<StickerField, string> = {
    seq: `#${d.seq}`,
    time: d.time,
    comment: d.comment,
    product: d.product,
    tiktok: d.tiktok,
    name: d.name,
    phone: d.phone,
    note: t.noteText.trim(),
  };
  const bold: Partial<Record<StickerField, boolean>> = { seq: true, tiktok: true, name: true };
  return STICKER_FIELDS.filter((f) => t.fields[f].show && value[f] !== "").map((f) => ({
    text: value[f],
    size: "md",
    px: t.fields[f].px,
    bold: bold[f],
    align: "center",
  }));
}

export function stickerSlip(t: StickerTemplate, d: StickerData): Slip {
  return { lines: stickerLines(t, d) };
}

export const SAMPLE_STICKER: StickerData = {
  seq: 6,
  time: "10/30 15:24",
  comment: "Chốt 2 áo size M",
  product: "A12 M x2",
  tiktok: "@cao240724",
  name: "Nguyễn Phương",
  phone: "0987654321",
};
