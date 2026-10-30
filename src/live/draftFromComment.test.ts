import { describe, expect, it } from "vitest";
import { avatarTone } from "../pages/ConsolePage";
import { DemoLiveCommentProvider } from "./demoProvider";
import { LiveSessionStore } from "./sessionStore";
import type { LiveCommentEvent } from "./types";

function started() {
  let n = 0;
  const store = new LiveSessionStore({
    newId: () => `sess-${++n}`,
    newDraftId: () => `d-${++n}`,
    createDemoProvider: () => new DemoLiveCommentProvider({ intervalMs: 3_600_000 }),
  });
  store.updateForm({ source: "demo" });
  return store;
}

const ev = (sessionId: string, id: string, text: string, user = "mai"): LiveCommentEvent => {
  const t = "2026-10-30T02:00:00.000Z";
  return {
    eventId: id,
    platform: "tiktok",
    sessionId,
    username: user,
    commentText: text,
    commentTimestamp: t,
    receivedAt: t,
    source: "DEMO",
  };
};

describe("draftFromComment", () => {
  it("makes a plain DRAFT with only the buyer and the comment, once", async () => {
    const store = started();
    await store.connectSource();
    store.startSession();
    const sid = store.getSnapshot().sessionId;
    store.receive(ev(sid, "e1", "chào shop"));
    const d = store.draftFromComment("e1");
    expect(d).toMatchObject({ username: "mai", status: "DRAFT", reasons: [] });
    expect(d?.sku).toBeUndefined();
    expect(d?.evidence).toEqual([{ eventId: "e1", field: "manual", text: "chào shop" }]);
    expect(store.draftFromComment("e1")?.id).toBe(d?.id); // no second draft
    expect(store.getSnapshot().drafts).toHaveLength(1);
  });

  it("returns undefined for an unknown comment and makes a new one after cancelling", async () => {
    const store = started();
    await store.connectSource();
    store.startSession();
    const sid = store.getSnapshot().sessionId;
    expect(store.draftFromComment("nope")).toBeUndefined();
    store.receive(ev(sid, "e1", "hi"));
    const d = store.draftFromComment("e1")!;
    store.setDraftStatus(d.id, "CANCELLED");
    expect(store.draftFromComment("e1")?.id).not.toBe(d.id);
  });
});

describe("avatarTone", () => {
  it("is stable per name and always a known tone", () => {
    expect(avatarTone("mai")).toBe(avatarTone("mai"));
    expect(avatarTone(undefined)).toBeTruthy();
  });
});
