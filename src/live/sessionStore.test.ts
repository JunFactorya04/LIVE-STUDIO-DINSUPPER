import { describe, expect, it } from "vitest";
import { DemoLiveCommentProvider } from "./demoProvider";
import { EulerProvider, type EulerBackend, type EulerEnvelope } from "./eulerProvider";
import { MemoryReplyRepository } from "../replies/repository";
import { AiError, type AiClient } from "../ai/client";
import { MemoryOrderRepository } from "../orders/repository";
import { MemoryLiveRepository, type LiveRepository } from "./repository";
import { LiveSessionStore, MAX_COMMENTS } from "./sessionStore";
import type { LiveCommentProvider } from "./provider";
import type { LiveCommentEvent, LiveProviderStatus } from "./types";

function makeStore() {
  let n = 0;
  return new LiveSessionStore({
    newId: () => `sess-${++n}`,
    // Long interval: tests push events by hand instead of waiting for timers.
    createDemoProvider: () => new DemoLiveCommentProvider({ intervalMs: 3_600_000 }),
  });
}

function event(sessionId: string, id: string, text = "A12"): LiveCommentEvent {
  const t = new Date(0).toISOString();
  return {
    eventId: id,
    platform: "tiktok",
    sessionId,
    username: "u1",
    commentText: text,
    commentTimestamp: t,
    receivedAt: t,
    source: "DEMO",
  };
}

describe("LiveSessionStore", () => {
  it("rejects an empty or malformed config and does not create a session", async () => {
    const store = makeStore();
    store.updateForm({ source: "live" });
    expect(await store.connectSource()).toBe(false);
    expect(store.getSnapshot().issues).toEqual(["NEED_URL_OR_USERNAME"]);
    store.updateForm({ liveUrl: "https://example.com/x" });
    expect(await store.connectSource()).toBe(false);
    expect(store.getSnapshot().issues).toContain("URL_FORMAT");
    expect(store.getSnapshot().status).toBe("DISCONNECTED");
  });

  it("valid URL but no live provider -> UNAVAILABLE, cannot start, never CONNECTED", async () => {
    const store = makeStore();
    const seen: LiveProviderStatus[] = [];
    store.subscribe(() => seen.push(store.getSnapshot().status));
    store.updateForm({
      source: "live",
      liveUrl: "https://www.tiktok.com/@shop/live",
      acknowledged: true,
    });
    await store.connectSource();
    expect(store.getSnapshot().status).toBe("UNAVAILABLE");
    expect(store.canStart()).toBe(false);
    expect(store.startSession()).toBe(false);
    expect(seen).not.toContain("CONNECTED");
  });

  it("demo mode runs with no URL, username or credentials", async () => {
    const store = makeStore();
    store.updateForm({ source: "demo" });
    expect(await store.connectSource()).toBe(true);
    expect(store.getSnapshot().status).toBe("DEMO");
    expect(store.getSnapshot().providerType).toBe("demo");
    expect(store.canStart()).toBe(true);
    expect(store.startSession()).toBe(true);
    expect(store.getSnapshot().startedAt).toBeDefined();
    await store.dispose();
  });

  it("stores a repeated event once and counts the duplicate", async () => {
    const store = makeStore();
    store.updateForm({ source: "demo" });
    await store.connectSource();
    const sid = store.getSnapshot().sessionId;
    expect(store.receive(event(sid, "e1"))).toBe(true);
    expect(store.receive(event(sid, "e1"))).toBe(false); // e.g. replay after reconnect
    expect(store.getSnapshot().comments).toHaveLength(1);
    expect(store.getSnapshot().duplicates).toBe(1);
    await store.dispose();
  });

  it("ignores events from another session, including after reconnecting", async () => {
    const store = makeStore();
    store.updateForm({ source: "demo" });
    await store.connectSource();
    const first = store.getSnapshot().sessionId;
    store.receive(event(first, "e1"));
    await store.connectSource(); // new session
    expect(store.getSnapshot().comments).toHaveLength(0);
    expect(store.receive(event(first, "e2"))).toBe(false);
    expect(store.getSnapshot().comments).toHaveLength(0);
    await store.dispose();
  });

  it("keeps zh-TW, Vietnamese, emoji and special characters intact", async () => {
    const store = makeStore();
    store.updateForm({ source: "demo" });
    await store.connectSource();
    const sid = store.getSnapshot().sessionId;
    const texts = ["黑色 M ×2", "Cho mình 2 cái nhé!!", "🔥😍", '<b>&amp;</b> "quote"'];
    texts.forEach((t, i) => store.receive(event(sid, `u${i}`, t)));
    expect(store.getSnapshot().comments.map((c) => c.commentText)).toEqual(texts);
    await store.dispose();
  });

  it("caps stored comments and stays fast under a burst", async () => {
    const store = makeStore();
    store.updateForm({ source: "demo" });
    await store.connectSource();
    const sid = store.getSnapshot().sessionId;
    const total = MAX_COMMENTS + 2000;
    const started = performance.now();
    for (let i = 0; i < total; i++) store.receive(event(sid, `b${i}`));
    const elapsed = performance.now() - started;
    const snap = store.getSnapshot();
    expect(snap.comments).toHaveLength(MAX_COMMENTS);
    expect(snap.dropped).toBe(2000);
    expect(snap.comments[0].eventId).toBe("b2000");
    expect(elapsed).toBeLessThan(3000);
    // A dropped event id can be accepted again (its key was released).
    expect(store.receive(event(sid, "b0"))).toBe(true);
    await store.dispose();
  });

  it("clearComments deletes the stored feed", async () => {
    const store = makeStore();
    store.updateForm({ source: "demo" });
    await store.connectSource();
    const sid = store.getSnapshot().sessionId;
    store.receive(event(sid, "e1"));
    store.clearComments();
    expect(store.getSnapshot().comments).toHaveLength(0);
    expect(store.receive(event(sid, "e1"))).toBe(true);
    await store.dispose();
  });

  it("endSession disconnects the provider and records the end time", async () => {
    const store = makeStore();
    store.updateForm({ source: "demo" });
    await store.connectSource();
    store.startSession();
    await store.endSession();
    expect(store.getSnapshot().status).toBe("DISCONNECTED");
    expect(store.getSnapshot().endedAt).toBeDefined();
  });
});

describe("LiveSessionStore persistence", () => {
  const storeWith = (repository: LiveRepository, ids = ["sess-1", "sess-2", "sess-3"]) => {
    let i = 0;
    return new LiveSessionStore({ repository, newId: () => ids[i++] ?? `sess-x${i}` });
  };

  async function manualSession(store: LiveSessionStore) {
    await store.connectSource();
    store.startSession();
  }

  it("manual source is the default, needs no URL or acknowledgement, and status is MANUAL", async () => {
    const store = storeWith(new MemoryLiveRepository());
    expect(store.getSnapshot().form.source).toBe("manual");
    expect(await store.connectSource()).toBe(true);
    expect(store.getSnapshot().status).toBe("MANUAL");
    expect(store.canStart()).toBe(true);
  });

  it("saves pasted comments and restores them (without dups) in a new store", async () => {
    const repo = new MemoryLiveRepository();
    const a = storeWith(repo);
    await manualSession(a);
    expect(a.submitManual("amy: 黑色 M\nbob: 要 2 件")).toEqual({ added: 2, duplicates: 0 });
    expect(a.submitManual("amy: 黑色 M")).toEqual({ added: 0, duplicates: 1 });
    await a.flush();

    const b = storeWith(repo);
    await b.restore();
    await b.restore(); // idempotent
    const snap = b.getSnapshot();
    expect(snap.sessionId).toBe("sess-2");
    expect(snap.comments.map((c) => c.commentText)).toEqual(["黑色 M", "要 2 件"]);
    expect(snap.restored).toBe(true);
    // A restored session has no live provider: never CONNECTED/MANUAL, and it is closed.
    expect(snap.status).toBe("DISCONNECTED");
    expect(snap.endedAt).toBeDefined();
    // Re-delivering a stored event is still a duplicate.
    expect(b.receive(snap.comments[0])).toBe(false);
    await b.flush();
    expect((await repo.latestSession())?.endedAt).toBeDefined();
  });

  describe("order drafts", () => {
    const item = { sku: "A12", name: "連帽衫", colors: ["黑色"], sizes: ["M"], aliases: [] };
    function pair() {
      const repo = new MemoryLiveRepository();
      const orders = new MemoryOrderRepository();
      const make = () => {
        let n = 0;
        let d = 0;
        return new LiveSessionStore({
          repository: repo,
          orders,
          newId: () => `sess-${++n}`,
          newDraftId: () => `od-${++d}`,
        });
      };
      return { orders, make };
    }

    it("builds drafts from pasted comments, needs the seller to confirm, and restores them", async () => {
      const { make } = pair();
      const a = make();
      a.saveCatalogItem(item);
      await manualSession(a);
      a.submitManual("amy: A12 黑色 M x2\nbob: Z99 x1\ncarol: 好漂亮");
      const [amy, bob] = a.getSnapshot().drafts;
      expect(a.getSnapshot().drafts).toHaveLength(2);
      expect(amy).toMatchObject({ username: "amy", status: "DRAFT", quantity: 2 });
      expect(bob).toMatchObject({ username: "bob", status: "NEEDS_REVIEW" });

      // Nothing is confirmed by itself, and a draft that needs review cannot be confirmed.
      expect(a.setDraftStatus(bob.id, "CONFIRMED")).toBe(false);
      expect(a.setDraftStatus(amy.id, "CONFIRMED")).toBe(true);
      expect(a.setDraftStatus(amy.id, "CONFIRMED")).toBe(false);
      await a.flush();

      const b = make();
      await b.restore();
      const snap = b.getSnapshot();
      expect(snap.catalog.map((c) => c.sku)).toEqual(["A12"]);
      expect(snap.drafts.map((d) => [d.username, d.status])).toEqual([
        ["amy", "CONFIRMED"],
        ["bob", "NEEDS_REVIEW"],
      ]);
      expect(snap.persistError).toBe(false);
    });

    it("the same pasted comment never makes a second draft", async () => {
      const { make } = pair();
      const a = make();
      a.saveCatalogItem(item);
      await manualSession(a);
      a.submitManual("amy: A12 黑色 M x2");
      a.submitManual("amy: A12 黑色 M x2");
      expect(a.getSnapshot().drafts).toHaveLength(1);
    });

    it("catalog changes are saved, imported and deleted in storage", async () => {
      const { orders, make } = pair();
      const a = make();
      a.saveCatalogItem(item);
      a.importCatalog([{ ...item, sku: "B7", name: "托特包", colors: [], sizes: [] }]);
      a.deleteCatalogItem("A12");
      await a.flush();
      expect((await orders.listCatalog()).map((c) => c.sku)).toEqual(["B7"]);
      expect(a.getSnapshot().catalog.map((c) => c.sku)).toEqual(["B7"]);
    });

    it("clearing comments keeps the order drafts", async () => {
      const { make } = pair();
      const a = make();
      a.saveCatalogItem(item);
      await manualSession(a);
      a.submitManual("amy: A12 黑色 M x2");
      a.clearComments();
      expect(a.getSnapshot().comments).toEqual([]);
      expect(a.getSnapshot().drafts).toHaveLength(1);
    });
  });

  describe("AI classification", () => {
    const cfg = () => ({ provider: "claude" as const, models: {} });
    function withAi(complete: AiClient["complete"], repo = new MemoryLiveRepository()) {
      let n = 0;
      return new LiveSessionStore({
        repository: repo,
        newId: () => `sess-${++n}`,
        ai: { available: true, complete },
        loadAiConfig: cfg,
      });
    }

    it("labels pending comments, saves the labels and restores them", async () => {
      const repo = new MemoryLiveRepository();
      let calls = 0;
      const a = withAi(async () => {
        calls += 1;
        return '[{"i":0,"intent":"PURCHASE","confidence":0.9},{"i":1,"intent":"SPAM","confidence":0.7}]';
      }, repo);
      await manualSession(a);
      a.submitManual("amy: A12 x2\nbob: 加我賺錢 http://x");
      await a.classifyPending();
      const c = a.getSnapshot().comments;
      expect(c.map((x) => x.intent)).toEqual(["PURCHASE", "SPAM"]);
      expect(a.getSnapshot().classifying).toBe(false);
      // Nothing left to classify: no second AI call.
      await a.classifyPending();
      expect(calls).toBe(1);
      await a.flush();

      const b = withAi(async () => "[]", repo);
      await b.restore();
      expect(b.getSnapshot().comments.map((x) => [x.intent, x.intentConfidence])).toEqual([
        ["PURCHASE", 0.9],
        ["SPAM", 0.7],
      ]);
    });

    it("an AI failure is shown as a code and nothing is half-saved", async () => {
      const a = withAi(async () => {
        throw new AiError("QUOTA");
      });
      await manualSession(a);
      a.submitManual("amy: hi");
      await a.classifyPending();
      expect(a.getSnapshot().aiError).toBe("QUOTA");
      expect(a.getSnapshot().comments[0].intent).toBeUndefined();
      expect(a.getSnapshot().classifying).toBe(false);
    });

    it("without a chosen AI service it asks for one and calls nothing", async () => {
      let called = false;
      const a = new LiveSessionStore({
        newId: () => "s",
        ai: { available: true, complete: async () => ((called = true), "[]") },
        loadAiConfig: () => ({ models: {} }),
      });
      await a.classifyPending();
      expect(a.getSnapshot().aiError).toBe("NO_PROVIDER");
      expect(called).toBe(false);
    });

    it("a malformed answer leaves comments unclassified", async () => {
      const a = withAi(async () => "Sure! I will buy it.");
      await manualSession(a);
      a.submitManual("amy: hi");
      await a.classifyPending();
      expect(a.getSnapshot().comments[0].intent).toBeUndefined();
      expect(a.getSnapshot().aiError).toBeUndefined();
    });

    // Phase 6 hardening: AI timeout and rate limit surface as readable codes, nothing is
    // half-saved, and the seller can simply retry once the service recovers.
    it.each(["TIMEOUT", "RATE_LIMIT", "NETWORK"] as const)(
      "an AI %s is shown as a code and a later retry succeeds",
      async (code) => {
        let fail = true;
        const a = withAi(async () => {
          if (fail) throw new AiError(code);
          return '[{"i":0,"intent":"PURCHASE","confidence":0.9}]';
        });
        await manualSession(a);
        a.submitManual("amy: hi");
        await a.classifyPending();
        expect(a.getSnapshot().aiError).toBe(code);
        expect(a.getSnapshot().comments[0].intent).toBeUndefined();
        expect(a.getSnapshot().classifying).toBe(false);

        fail = false;
        await a.classifyPending();
        expect(a.getSnapshot().aiError).toBeUndefined();
        expect(a.getSnapshot().comments[0].intent).toBe("PURCHASE");
      },
    );
  });

  describe("provider disconnect / network loss (Phase 6 hardening)", () => {
    it("a provider that drops mid-session reports DISCONNECTED, not a fake CONNECTED", async () => {
      let statusHandler: ((status: LiveProviderStatus, reason?: string) => void) | undefined;
      const provider: LiveCommentProvider = {
        type: "live",
        async getStatus() {
          return "CONNECTED";
        },
        async connect() {
          statusHandler?.("CONNECTED");
        },
        async disconnect() {
          statusHandler?.("DISCONNECTED");
        },
        onComment: () => () => {},
        onStatusChange(handler) {
          statusHandler = handler;
          return () => (statusHandler = undefined);
        },
      };
      const a = new LiveSessionStore({ newId: () => "s", createLiveProvider: () => provider });
      a.updateForm({ source: "live", username: "shop", acknowledged: true });
      await a.connectSource();
      expect(a.getSnapshot().status).toBe("CONNECTED");
      expect(a.startSession()).toBe(true);

      // The network drops: the provider reports it lost the connection on its own, mid-session.
      statusHandler?.("DISCONNECTED", "NETWORK");
      expect(a.getSnapshot().status).toBe("DISCONNECTED");
      expect(a.getSnapshot().statusReason).toBe("NETWORK");
      // A seller can't be shown "still live" once the source itself says otherwise.
      expect(a.getSnapshot().status).not.toBe("CONNECTED");
    });
  });

  describe("reply suggestions", () => {
    function make(
      answer: string,
      repo = new MemoryLiveRepository(),
      replies = new MemoryReplyRepository(),
    ) {
      let n = 0;
      let r = 0;
      return new LiveSessionStore({
        repository: repo,
        replies,
        newId: () => `sess-${++n}`,
        newReplyId: () => `rs-${++r}`,
        ai: { available: true, complete: async () => answer },
        loadAiConfig: () => ({ provider: "claude", models: {} }),
        loadPolicy: () => "7-11",
      });
    }

    it("drafts a reply, tracks edit and copy, and restores it; nothing is ever sent", async () => {
      const repo = new MemoryLiveRepository();
      const replies = new MemoryReplyRepository();
      const a = make("明天出貨喔", repo, replies);
      await manualSession(a);
      a.submitManual("amy: 什麼時候出貨?");
      const c = a.getSnapshot().comments[0];
      await a.suggestReply(c.eventId, c.source);
      const [r] = a.getSnapshot().replies;
      expect(r).toMatchObject({
        text: "明天出貨喔",
        status: "DRAFT",
        approvedByUser: false,
        modelProvider: "claude",
      });

      expect(a.updateReply(r.id, { text: "  " })).toBe(false);
      a.updateReply(r.id, { status: "COPIED" });
      expect(a.getSnapshot().replies[0]).toMatchObject({ status: "COPIED", approvedByUser: true });
      a.updateReply(r.id, { text: "今天下單明天出貨" });
      expect(a.getSnapshot().replies[0]).toMatchObject({ status: "DRAFT", approvedByUser: false });
      a.updateReply(r.id, { status: "COPIED" });
      await a.flush();

      const b = make("x", repo, replies);
      await b.restore();
      expect(b.getSnapshot().replies[0]).toMatchObject({
        text: "今天下單明天出貨",
        status: "COPIED",
      });
      expect(b.getSnapshot().replies.every((x) => (x.status as string) !== "SENT")).toBe(true);
    });

    it("an unsafe AI answer (link or phone number) is not saved", async () => {
      const a = make("加我 LINE 0912345678 或 https://x.co");
      await manualSession(a);
      a.submitManual("amy: hi");
      const c = a.getSnapshot().comments[0];
      await a.suggestReply(c.eventId, c.source);
      expect(a.getSnapshot().replies).toEqual([]);
      expect(a.getSnapshot().aiError).toBe("BAD_RESPONSE");
      expect(a.getSnapshot().suggestingFor).toBeUndefined();
    });
  });

  it("restore with an empty database leaves a clean store", async () => {
    const store = storeWith(new MemoryLiveRepository());
    await store.restore();
    expect(store.getSnapshot().restored).toBe(false);
    expect(store.getSnapshot().comments).toEqual([]);
  });

  it("clearing comments deletes them from storage too", async () => {
    const repo = new MemoryLiveRepository();
    const a = storeWith(repo);
    await manualSession(a);
    a.submitManual("amy: hi");
    await a.flush();
    a.clearComments();
    await a.flush();
    expect(await repo.listComments("sess-2", 10)).toEqual([]);
  });

  it("a failing database sets persistError but keeps the comments on screen", async () => {
    const repo = new MemoryLiveRepository();
    repo.ingest = async () => {
      throw new Error("disk full");
    };
    const store = storeWith(repo);
    await manualSession(store);
    store.submitManual("amy: hi");
    await store.flush();
    expect(store.getSnapshot().persistError).toBe(true);
    expect(store.getSnapshot().comments).toHaveLength(1);
  });

  it("submitManual is ignored before the session starts and after it ends", async () => {
    const store = storeWith(new MemoryLiveRepository());
    await store.connectSource();
    expect(store.submitManual("amy: hi").added).toBe(0);
    store.startSession();
    expect(store.submitManual("amy: hi").added).toBe(1);
    await store.endSession();
    expect(store.submitManual("bob: yo").added).toBe(0);
  });
});

describe("LiveSessionStore with the Euler provider", () => {
  function fakeBackend() {
    let handler: ((e: EulerEnvelope) => void) | undefined;
    const backend: EulerBackend = {
      connect: async () => undefined,
      disconnect: async () => undefined,
      subscribe: async (h) => {
        handler = h;
        return () => undefined;
      },
    };
    return { backend, push: (e: EulerEnvelope) => handler?.(e) };
  }

  it("is CONNECTING until proof, then CONNECTED; comments are stored once and saved", async () => {
    const { backend, push } = fakeBackend();
    const repo = new MemoryLiveRepository();
    const store = new LiveSessionStore({
      repository: repo,
      newId: () => "s",
      createLiveProvider: () => new EulerProvider(backend),
    });
    store.updateForm({ source: "live", username: "shop_tw", acknowledged: true });
    await store.connectSource();
    expect(store.getSnapshot().status).toBe("CONNECTING");
    expect(store.canStart()).toBe(false);

    push({ sessionId: "s", kind: "status", status: "CONNECTED" });
    expect(store.getSnapshot().status).toBe("CONNECTED");
    expect(store.startSession()).toBe(true);

    const c = { eventId: "euler-1", username: "amy", commentText: "要 2 件" };
    push({ sessionId: "s", kind: "comments", comments: [c, c] });
    expect(store.getSnapshot().comments).toHaveLength(1);
    expect(store.getSnapshot().duplicates).toBe(1);
    await store.flush();
    expect(await repo.listComments("s", 10)).toHaveLength(1);

    push({ sessionId: "s", kind: "status", status: "DISCONNECTED", reason: "NOT_LIVE" });
    expect(store.getSnapshot().status).toBe("DISCONNECTED");
    expect(store.getSnapshot().statusReason).toBe("NOT_LIVE");
  });

  it("the live source still requires the acknowledgement", async () => {
    const { backend, push } = fakeBackend();
    const store = new LiveSessionStore({
      repository: new MemoryLiveRepository(),
      newId: () => "s",
      createLiveProvider: () => new EulerProvider(backend),
    });
    store.updateForm({ source: "live", username: "shop_tw" });
    await store.connectSource();
    push({ sessionId: "s", kind: "status", status: "CONNECTED" });
    expect(store.canStart()).toBe(false);
    store.updateForm({ acknowledged: true });
    expect(store.canStart()).toBe(true);
  });
});
