import type { LiveCommentEvent } from "./types";

// Parses chat text that the seller copied from their own LIVE screen.
// Each non-empty line is one comment. "name: text" or "@name: text" splits the user;
// otherwise the whole line is the comment text.

export const MAX_PASTE_LINES = 500;
export const MAX_PASTE_CHARS = 500;

const LINE = /^@?([A-Za-z0-9._]{2,24})\s*[:：]\s*(.+)$/u;

/** 32-bit FNV-1a, hex. Stable across runs, so a re-pasted line gets the same id. */
export function fnv1a(input: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

function normalize(text: string): string {
  return text.normalize("NFC").replace(/\s+/gu, " ").trim();
}

export function parsePastedChat(
  raw: string,
  sessionId: string,
  now: Date = new Date(),
): LiveCommentEvent[] {
  const stamp = now.toISOString();
  const occurrences = new Map<string, number>();
  const events: LiveCommentEvent[] = [];

  for (const line of raw.split(/\r?\n/u).slice(0, MAX_PASTE_LINES)) {
    const clean = normalize(line);
    if (!clean) continue;
    const m = LINE.exec(clean);
    const username = m?.[1];
    const commentText = Array.from(m ? m[2] : clean)
      .slice(0, MAX_PASTE_CHARS)
      .join("");

    const key = `${username ?? ""}|${commentText}`;
    const n = occurrences.get(key) ?? 0;
    occurrences.set(key, n + 1);

    events.push({
      eventId: `paste-${fnv1a(key)}-${n}`,
      platform: "tiktok",
      sessionId,
      username,
      commentText,
      commentTimestamp: stamp,
      receivedAt: stamp,
      source: "MANUAL",
    });
  }
  return events;
}
