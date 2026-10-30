import { validateLiveConfig, type ConfigIssue } from "./config";
import { DemoLiveCommentProvider } from "./demoProvider";
import { NoSourceProvider } from "./noSourceProvider";
import type { LiveCommentProvider } from "./provider";
import type { LiveCommentEvent, LiveProviderStatus } from "./types";

// Framework-free store for one LIVE session. React reads it through
// useSyncExternalStore (see ./useLiveSession.ts).
//
// Rules enforced here (spec sections 4.2, 6.2, 10):
//  - status comes only from the provider; the store never invents "CONNECTED";
//  - one event is stored once (dedup key: session + source + event id);
//  - at most MAX_COMMENTS are kept (oldest dropped) to bound memory.

export const MAX_COMMENTS = 1000;

export interface LiveForm {
  liveUrl: string;
  username: string;
  acknowledged: boolean;
  demo: boolean;
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
}

export interface StoreDeps {
  createDemoProvider?: () => LiveCommentProvider;
  createNoSourceProvider?: () => LiveCommentProvider;
  newId?: () => string;
  now?: () => Date;
}

const EMPTY_FORM: LiveForm = { liveUrl: "", username: "", acknowledged: false, demo: false };

function defaultId(): string {
  return `ls-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export class LiveSessionStore {
  private snapshot: LiveSessionSnapshot;
  private listeners = new Set<() => void>();
  private provider: LiveCommentProvider | undefined;
  private providerUnsubs: Array<() => void> = [];
  private seen = new Set<string>();

  constructor(private readonly deps: StoreDeps = {}) {
    this.snapshot = this.freshSnapshot();
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
    if (status !== "CONNECTED" && status !== "DEMO") return false;
    return form.demo || form.acknowledged;
  }

  async connectSource(): Promise<boolean> {
    const { form } = this.snapshot;
    const result = validateLiveConfig(form.liveUrl, form.username);
    // Demo mode may run without a URL/username, but a malformed value is still rejected.
    const blocking = form.demo
      ? result.issues.filter((i) => i !== "NEED_URL_OR_USERNAME")
      : result.issues;
    if (blocking.length > 0) {
      this.set({ issues: blocking });
      return false;
    }

    await this.teardownProvider();
    this.seen.clear();
    const sessionId = (this.deps.newId ?? defaultId)();
    const provider = form.demo
      ? (this.deps.createDemoProvider?.() ?? new DemoLiveCommentProvider())
      : (this.deps.createNoSourceProvider?.() ?? new NoSourceProvider());
    this.provider = provider;
    this.providerUnsubs = [
      provider.onStatusChange((status) => this.set({ status })),
      provider.onComment((event) => this.receive(event)),
    ];
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
    this.set({
      startedAt: (this.deps.now ?? (() => new Date()))().toISOString(),
      endedAt: undefined,
    });
    return true;
  }

  async endSession(): Promise<void> {
    const { sessionId } = this.snapshot;
    await this.provider?.disconnect(sessionId);
    this.set({ endedAt: (this.deps.now ?? (() => new Date()))().toISOString() });
  }

  /** Accept one normalized event. Returns false when it is ignored. */
  receive(event: LiveCommentEvent): boolean {
    if (event.sessionId !== this.snapshot.sessionId) return false;
    const key = `${event.sessionId}|${event.source}|${event.eventId}`;
    if (this.seen.has(key)) {
      this.set({ duplicates: this.snapshot.duplicates + 1 });
      return false;
    }
    this.seen.add(key);

    let comments = [...this.snapshot.comments, event];
    let dropped = this.snapshot.dropped;
    while (comments.length > MAX_COMMENTS) {
      const [oldest, ...rest] = comments;
      this.seen.delete(`${oldest.sessionId}|${oldest.source}|${oldest.eventId}`);
      comments = rest;
      dropped += 1;
    }
    this.set({ comments, dropped });
    return true;
  }

  /** Delete the stored comments of the current session (spec section 10). */
  clearComments(): void {
    this.seen.clear();
    this.set({ comments: [], duplicates: 0, dropped: 0 });
  }

  async dispose(): Promise<void> {
    await this.teardownProvider();
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
    };
  }

  private set(patch: Partial<LiveSessionSnapshot>): void {
    this.snapshot = { ...this.snapshot, ...patch };
    this.listeners.forEach((l) => l());
  }
}
