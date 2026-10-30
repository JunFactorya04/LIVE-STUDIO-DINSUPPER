import { validateLiveConfig, type ConfigIssue } from "./config";
import { DemoLiveCommentProvider } from "./demoProvider";
import { ManualPasteProvider } from "./manualProvider";
import { NoSourceProvider } from "./noSourceProvider";
import type { LiveCommentProvider } from "./provider";
import { createRepository, type LiveRepository } from "./repository";
import type { LiveCommentEvent, LiveProviderStatus } from "./types";

// Framework-free store for one LIVE session. React reads it through
// useSyncExternalStore (see ./useLiveSession.ts).
//
// Rules enforced here (spec sections 4.2, 6.2, 10):
//  - status comes only from the provider; the store never invents "CONNECTED";
//  - one event is stored once (dedup key: session + source + event id);
//  - at most MAX_COMMENTS are kept (oldest dropped) to bound memory;
//  - every accepted comment is written to the repository (SQLite in the app) through one
//    serialized queue, so a session row always exists before its comments; a failed write
//    sets `persistError` instead of being hidden.

export const MAX_COMMENTS = 1000;

/** manual = paste from your own screen · demo = fake script · live = a verified provider. */
export type SourceMode = "manual" | "demo" | "live";

export interface LiveForm {
  liveUrl: string;
  username: string;
  acknowledged: boolean;
  source: SourceMode;
}

export interface LiveSessionSnapshot {
  sessionId: string;
  form: LiveForm;
  issues: readonly ConfigIssue[];
  status: LiveProviderStatus;
  providerType: string | undefined;
  startedAt: string | undefined;
  endedAt: string | undefined;
  comments: readonly LiveCommentEvent[];
  duplicates: number;
  dropped: number;
  /** True when this session was loaded from storage after a restart. */
  restored: boolean;
  /** True when a write to storage failed; the comments on screen may not be saved. */
  persistError: boolean;
}

export interface StoreDeps {
  repository?: LiveRepository;
  createDemoProvider?: () => LiveCommentProvider;
  createNoSourceProvider?: () => LiveCommentProvider;
  newId?: () => string;
  now?: () => Date;
}

const EMPTY_FORM: LiveForm = { liveUrl: "", username: "", acknowledged: false, source: "manual" };

function defaultId(): string {
  return `ls-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export class LiveSessionStore {
  private snapshot: LiveSessionSnapshot;
  private listeners = new Set<() => void>();
  private provider: LiveCommentProvider | undefined;
  private providerUnsubs: Array<() => void> = [];
  private manual: ManualPasteProvider | undefined;
  private seen = new Set<string>();
  private readonly repo: LiveRepository;
  private queue: Promise<void> = Promise.resolve();
  private restoring: Promise<void> | undefined;

  constructor(private readonly deps: StoreDeps = {}) {
    this.repo = deps.repository ?? createRepository();
    this.snapshot = this.freshSnapshot();
  }

  /** Wait until every queued write has been attempted. */
  flush(): Promise<void> {
    return this.queue;
  }

  private persist(job: () => Promise<unknown>): void {
    this.queue = this.queue
      .then(job)
      .then(() => undefined)
      .catch(() => this.set({ persistError: true }));
  }

  /** Load the latest stored session. Safe to call more than once. */
  restore(): Promise<void> {
    this.restoring ??= this.doRestore();
    return this.restoring;
  }

  private async doRestore(): Promise<void> {
    try {
      const stored = await this.repo.latestSession();
      if (!stored || this.snapshot.providerType) return; // nothing saved, or user already started
      const comments = await this.repo.listComments(stored.id, MAX_COMMENTS);
      if (this.snapshot.providerType) return;
      this.seen = new Set(comments.map((c) => `${c.sessionId}|${c.source}|${c.eventId}`));
      const source: SourceMode =
        stored.providerType === "manual"
          ? "manual"
          : stored.providerType === "demo"
            ? "demo"
            : "live";
      // A provider cannot survive a restart, so an unfinished session is closed honestly.
      const endedAt = stored.endedAt ?? this.nowIso();
      if (!stored.endedAt && stored.startedAt) {
        this.persist(() => this.repo.updateSession(stored.id, { status: "DISCONNECTED", endedAt }));
      }
      this.set({
        sessionId: stored.id,
        form: {
          ...this.snapshot.form,
          source,
          liveUrl: stored.liveUrl ?? "",
          username: stored.username ?? "",
        },
        status: "DISCONNECTED",
        providerType: undefined,
        startedAt: stored.startedAt,
        endedAt: stored.startedAt ? endedAt : undefined,
        comments,
        restored: comments.length > 0,
      });
    } catch {
      this.set({ persistError: true });
    }
  }

  private nowIso(): string {
    return (this.deps.now ?? (() => new Date()))().toISOString();
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = (): LiveSessionSnapshot => this.snapshot;

  updateForm(patch: Partial<LiveForm>): void {
    this.set({ form: { ...this.snapshot.form, ...patch }, issues: [] });
  }

  /** True when the seller may start: provider confirmed a source and config is complete. */
  canStart(): boolean {
    const { status, form, startedAt, endedAt } = this.snapshot;
    if (startedAt && !endedAt) return false;
    if (status !== "CONNECTED" && status !== "DEMO" && status !== "MANUAL") return false;
    return form.source !== "live" || form.acknowledged;
  }

  async connectSource(): Promise<boolean> {
    const { form } = this.snapshot;
    const result = validateLiveConfig(form.liveUrl, form.username);
    // Manual and demo modes may run without a URL/username, but a malformed value is still rejected.
    const blocking =
      form.source !== "live"
        ? result.issues.filter((i) => i !== "NEED_URL_OR_USERNAME")
        : result.issues;
    if (blocking.length > 0) {
      this.set({ issues: blocking });
      return false;
    }

    await this.teardownProvider();
    this.seen.clear();
    const sessionId = (this.deps.newId ?? defaultId)();
    this.manual = undefined;
    let provider: LiveCommentProvider;
    if (form.source === "manual") {
      this.manual = new ManualPasteProvider();
      provider = this.manual;
    } else if (form.source === "demo") {
      provider = this.deps.createDemoProvider?.() ?? new DemoLiveCommentProvider();
    } else {
      provider = this.deps.createNoSourceProvider?.() ?? new NoSourceProvider();
    }
    this.provider = provider;
    this.providerUnsubs = [
      provider.onStatusChange((status) => {
        this.set({ status });
        this.persist(() => this.repo.updateSession(sessionId, { status }));
      }),
      provider.onComment((event) => this.receive(event)),
    ];
    this.persist(() =>
      this.repo.createSession({
        id: sessionId,
        liveUrl: result.liveUrl,
        username: result.username,
        providerType: provider.type,
        status: "CONNECTING",
      }),
    );
    this.set({
      sessionId,
      issues: [],
      comments: [],
      duplicates: 0,
      dropped: 0,
      startedAt: undefined,
      endedAt: undefined,
      providerType: provider.type,
      status: "CONNECTING",
      restored: false,
      persistError: false,
    });

    try {
      await provider.connect({
        sessionId,
        liveUrl: result.liveUrl,
        username: result.username,
      });
    } catch {
      this.set({ status: "ERROR" });
      return false;
    }
    return true;
  }

  startSession(): boolean {
    if (!this.canStart()) return false;
    const startedAt = this.nowIso();
    const { sessionId } = this.snapshot;
    this.set({ startedAt, endedAt: undefined });
    this.persist(() => this.repo.updateSession(sessionId, { startedAt }));
    return true;
  }

  async endSession(): Promise<void> {
    const { sessionId } = this.snapshot;
    await this.provider?.disconnect(sessionId);
    const endedAt = this.nowIso();
    this.set({ endedAt });
    this.persist(() => this.repo.updateSession(sessionId, { endedAt }));
  }

  /** Feed pasted chat into a manual session. Returns how many comments were new. */
  submitManual(text: string): { added: number; duplicates: number } {
    const { startedAt, endedAt, status } = this.snapshot;
    if (!this.manual || status !== "MANUAL" || !startedAt || endedAt) {
      return { added: 0, duplicates: 0 };
    }
    const events = this.manual.parse(text, (this.deps.now ?? (() => new Date()))());
    const added = this.receiveMany(events);
    return { added, duplicates: events.length - added };
  }

  /** Accept one normalized event. Returns false when it is ignored. */
  receive(event: LiveCommentEvent): boolean {
    return this.receiveMany([event]) === 1;
  }

  /** Accept a batch; one storage write for the whole batch. Returns how many were new. */
  receiveMany(events: readonly LiveCommentEvent[]): number {
    const accepted: LiveCommentEvent[] = [];
    let duplicates = this.snapshot.duplicates;
    for (const event of events) {
      if (event.sessionId !== this.snapshot.sessionId) continue;
      const key = `${event.sessionId}|${event.source}|${event.eventId}`;
      if (this.seen.has(key)) {
        duplicates += 1;
        continue;
      }
      this.seen.add(key);
      accepted.push(event);
    }

    let comments = accepted.length
      ? [...this.snapshot.comments, ...accepted]
      : this.snapshot.comments;
    let dropped = this.snapshot.dropped;
    if (comments.length > MAX_COMMENTS) {
      const extra = comments.length - MAX_COMMENTS;
      for (const old of comments.slice(0, extra)) {
        this.seen.delete(`${old.sessionId}|${old.source}|${old.eventId}`);
      }
      comments = comments.slice(extra);
      dropped += extra;
    }
    if (accepted.length || duplicates !== this.snapshot.duplicates) {
      this.set({ comments, dropped, duplicates });
    }
    if (accepted.length) this.persist(() => this.repo.ingest(accepted));
    return accepted.length;
  }

  /** Delete the stored comments of the current session (spec section 10). */
  clearComments(): void {
    const { sessionId } = this.snapshot;
    this.seen.clear();
    this.set({ comments: [], duplicates: 0, dropped: 0, restored: false });
    this.persist(() => this.repo.deleteComments(sessionId));
  }

  async dispose(): Promise<void> {
    await this.teardownProvider();
    await this.flush();
  }

  private async teardownProvider(): Promise<void> {
    this.providerUnsubs.forEach((u) => u());
    this.providerUnsubs = [];
    const provider = this.provider;
    this.provider = undefined;
    if (provider) await provider.disconnect(this.snapshot.sessionId);
  }

  private freshSnapshot(): LiveSessionSnapshot {
    return {
      sessionId: (this.deps.newId ?? defaultId)(),
      form: { ...EMPTY_FORM },
      issues: [],
      status: "DISCONNECTED",
      providerType: undefined,
      startedAt: undefined,
      endedAt: undefined,
      comments: [],
      duplicates: 0,
      dropped: 0,
      restored: false,
      persistError: false,
    };
  }

  private set(patch: Partial<LiveSessionSnapshot>): void {
    this.snapshot = { ...this.snapshot, ...patch };
    this.listeners.forEach((l) => l());
  }
}
