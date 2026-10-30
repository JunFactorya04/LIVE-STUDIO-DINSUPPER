import { describe, expect, it } from "vitest";
import { MAX_PASTE_CHARS, MAX_PASTE_LINES, parsePastedChat } from "./paste";

const parse = (text: string) => parsePastedChat(text, "s1", new Date("2026-10-30T02:00:00Z"));

describe("parsePastedChat", () => {
  it("splits user and text, handles @ and full-width colon, keeps plain lines whole", () => {
    const e = parse("amy: 黑色 M ×2\n@bob：還有貨嗎\n純留言沒有帳號 🔥");
    expect(e.map((x) => [x.username, x.commentText])).toEqual([
      ["amy", "黑色 M ×2"],
      ["bob", "還有貨嗎"],
      [undefined, "純留言沒有帳號 🔥"],
    ]);
    expect(e.every((x) => x.source === "MANUAL" && x.sessionId === "s1")).toBe(true);
  });

  it("skips blank lines and handles CRLF", () => {
    expect(parse("a1: x\r\n\r\n   \r\nb2: y")).toHaveLength(2);
  });

  it("gives the same ids when the same text is pasted again", () => {
    const a = parse("amy: hi\nbob: yo").map((x) => x.eventId);
    const b = parse("amy: hi\nbob: yo").map((x) => x.eventId);
    expect(a).toEqual(b);
  });

  it("keeps genuine repeats inside one paste as separate comments", () => {
    const ids = parse("amy: +1\namy: +1\namy: +1").map((x) => x.eventId);
    expect(new Set(ids).size).toBe(3);
  });

  it("caps lines and comment length", () => {
    expect(parse("x".repeat(10) + "\n").length).toBe(1);
    const many = Array.from({ length: MAX_PASTE_LINES + 50 }, (_, i) => `u${i}: t${i}`).join("\n");
    expect(parse(many)).toHaveLength(MAX_PASTE_LINES);
    expect(Array.from(parse("啊".repeat(2000))[0].commentText)).toHaveLength(MAX_PASTE_CHARS);
  });
});
