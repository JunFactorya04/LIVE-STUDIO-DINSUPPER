import { describe, expect, it } from "vitest";
import {
  EulerProvider,
  toCommentEvent,
  type EulerBackend,
  type EulerEnvelope,
} from "./eulerProvider";
import type { LiveCommentEvent, LiveProviderStatus } from "./types";

class FakeBackend implements EulerBackend {
  handler: ((e: EulerEnvelope) => void) | undefined;
  calls: string[] = [];
  async connect(sessionId: string, uniqueId: string) {
    this.calls.push(`connect:${sessionId}:${uniqueId}`);
  }
  async disconnect() {
    this.calls.push("disconnect");
  }
  async subscribe(h: (e: EulerEnvelope) => void) {
    this.handler = h;
    return () => {
      this.handler = undefined;
    };
  }
  push(e: EulerEnvelope) {
    this.handler?.(e);
  }
}

const NOW = new Date("2026-10-30T03:00:00Z");

function setup() {
  const backend = new FakeBackend();
  const provider = new EulerProvider(backend, () => NOW);
  const statuses: Array<[LiveProviderStatus, string | undefined]> = [];
  const comments: LiveCommentEvent[] = [];
  provider.onStatusChange((s, r) => statuses.push([s, r]));
  provider.onComment((c) => comments.push(c));
  return { backend, provider, statuses, comments };
}

describe("EulerProvider", () => {
  it("without a backend (plain browser) it is UNAVAILABLE with reason BROWSER, never CONNECTED", async () => {
    const provider = new EulerProvider(undefined);
    const seen: Array<[LiveProviderStatus, string | undefined]> = [];
    provider.onStatusChange((s, r) => seen.push([s, r]));
    await provider.connect({ sessionId: "s1", username: "shop" });
    expect(seen).toEqual([["UNAVAILABLE", "BROWSER"]]);
  });

  it("is CONNECTING until the backend proves the connection", async () => {
    const { backend, provider, statuses } = setup();
    await provider.connect({ sessionId: "s1", username: "shop" });
    expect(backend.calls).toEqual(["connect:s1:shop"]);
    expect(statuses).toEqual([["CONNECTING", undefined]]);
    backend.push({ sessionId: "s1", kind: "status", status: "CONNECTED" });
    expect(statuses[statuses.length - 1]).toEqual(["CONNECTED", undefined]);
  });

  it("turns comments into UNOFFICIAL_CONNECTOR events with the service timestamp", async () => {
    const { backend, provider, comments } = setup();
    await provider.connect({ sessionId: "s1", username: "shop" });
    backend.push({
      sessionId: "s1",
      kind: "comments",
      comments: [
        {
          eventId: "euler-1",
          username: "amy",
          displayName: "Amy",
          commentText: "黑色 M ×2",
          commentTimestampMs: 1_761_800_000_000,
        },
        { eventId: "euler-2", commentText: "no time or user" },
      ],
    });
    expect(comments).toHaveLength(2);
    expect(comments[0]).toMatchObject({
      eventId: "euler-1",
      sessionId: "s1",
      source: "UNOFFICIAL_CONNECTOR",
      username: "amy",
      commentTimestamp: new Date(1_761_800_000_000).toISOString(),
    });
    // No usable time: fall back to when we received it.
    expect(comments[1].commentTimestamp).toBe(NOW.toISOString());
    expect(comments[1].username).toBeUndefined();
  });

  it("passes the reason through and ignores events from another session", async () => {
    const { backend, provider, statuses, comments } = setup();
    await provider.connect({ sessionId: "s1", username: "shop" });
    backend.push({
      sessionId: "OTHER",
      kind: "comments",
      comments: [{ eventId: "x", commentText: "hi" }],
    });
    backend.push({ sessionId: "s1", kind: "status", status: "DISCONNECTED", reason: "NOT_LIVE" });
    expect(comments).toHaveLength(0);
    expect(statuses[statuses.length - 1]).toEqual(["DISCONNECTED", "NOT_LIVE"]);
  });

  it("rejects a missing username and cleans up on disconnect", async () => {
    const a = setup();
    await a.provider.connect({ sessionId: "s1" });
    expect(a.statuses[a.statuses.length - 1]).toEqual(["ERROR", "INVALID_OPTIONS"]);

    const b = setup();
    await b.provider.connect({ sessionId: "s2", username: "shop" });
    await b.provider.disconnect("s2");
    expect(b.backend.calls).toContain("disconnect");
    expect(b.backend.handler).toBeUndefined();
    expect(b.statuses[b.statuses.length - 1][0]).toBe("DISCONNECTED");
  });

  it("toCommentEvent keeps the event id so the store can dedupe replays", () => {
    const e = toCommentEvent({ eventId: "euler-9", commentText: "hi" }, "s1", NOW);
    expect(e.eventId).toBe("euler-9");
  });
});
