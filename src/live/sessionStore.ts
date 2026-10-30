import { validateLiveConfig, type ConfigIssue } from "./config";
import { DemoLiveCommentProvider } from "./demoProvider";
import { ManualPasteProvider } from "./manualProvider";
import { EulerProvider, createEulerBackend } from "./eulerProvider";
import type { LiveCommentProvider } from "./provider";
import { createRepository, type LiveRepository } from "./repository";
import type { LiveCommentEvent, LiveProviderStatus } from "./types";
import { createReplyRepository, type ReplyRepository } from "../replies/repository";
import { REPLY_SYSTEM, buildReplyPrompt, cleanReply, loadPolicy } from "../replies/suggest";
import type { ReplyStatus, ReplySuggestion } from "../replies/types";
import { classifyBatch, BATCH_SIZE, MAX_PER_RUN } from "../ai/classifier";
import { createAiClient, type AiClient, type AiErrorCode } from "../ai/client";
import { loadAiConfig, type AiConfig } from "../ai/config";
import { applyComment, canTransition } from "../orders/engine";
import { createOrderRepository, type OrderRepository } from "../orders/repository";
import type { CatalogItem, OrderDraft, OrderStatus } from "../orders/types";

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
  /** Translatable key explaining the status (e.g. NOT_LIVE, INVALID_AUTH), if any. */
  statusReason: string | undefined;
  providerType: string | undefined;
  startedAt: string | undefined;
  endedAt: string | undefined;
  comments: readonly LiveCommentEvent[];
  /** Product list of the shop (kept across sessions). */
  catalog: readonly CatalogItem[];
  /** Order drafts of this session, built from comments; the seller confirms them. */
  drafts: readonly OrderDraft[];
  duplicates: number;
  dropped: number;
  /** True when this session was loaded from storage after a restart. */
  restored: boolean;
  /** Reply suggestions of this session (drafts for the seller; never sent by the app). */
  replies: readonly ReplySuggestion[];
  /** Event id of the comment a reply is being drafted for. */
  suggestingFor: string | undefined;
  /** True while the AI is labelling comments. */
  classifying: boolean;
  /** Why the last AI run stopped early; NO_PROVIDER = no AI service chosen in Settings. */
  aiError: AiErrorCode | "NO_PROVIDER" | undefined;
  /** True when a write to storage failed; the comments on screen may not be saved. */
  persistError: boolean;
}

export interface StoreDeps {
  repository?: LiveRepository;
  orders?: OrderRepository;
  ai?: AiClient;
  replies?: ReplyRepository;
  loadPolicy?: () => string;
  newReplyId?: () => string;
  loadAiConfig?: () => AiConfig;
  newDraftId?: () => string;
  createDemoProvider?: () => LiveCommentProvider;
  createLiveProvider?: () => LiveCommentProvider;
  newId?: () => string;
  now?: () => Date;
}

const EMPTY_FORM: LiveForm = { liveUrl: "", username: "", acknowledged: false, source: "manual" };

function defaultId(): string {
  return `ls-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function defaultDraftId(): string {
  return `od-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function mergeCatalog(
  current: readonly CatalogItem[],
  incoming: readonly CatalogItem[],
): CatalogItem[] {
  const map = new Map(current.map((c) => [c.sku, c]));
  for (const item of incoming) map.set(item.sku, item);
  return [...map.values()].sort((a, b) => a.sku.localeCompare(b.sku));
}

export class LiveSessionStore {
  private snapshot: LiveSessionSnapshot;
  private listeners = new Set<() => void>();
  private provider: LiveCommentProvider | undefined;
  private providerUnsubs: Array<() => void> = [];
  private manual: ManualPasteProvider | undefined;
  private seen = new Set<string>();
  private readonly repo: LiveRepository;
  private readonly orders: OrderRepository;
  private readonly replyRepo: ReplyRepository;
  private queue: Promise<void> = Promise.resolve();
  private restoring: Promise<void> | undefined;

  constructor(private readonly deps: StoreDeps = {}) {
    this.repo = deps.repository ?? createRepository();
    this.orders = deps.orders ?? createOrderRepository();
    this.replyRepo = deps.replies ?? createReplyRepository();
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
      const stored = await this.orders.listCatalog();
      // Items typed before the load finished are newer than the stored ones.
      this.set({ catalog: mergeCatalog(stored, this.snapshot.catalog) });
    } catch {
      this.set({ persistError: true });
    }
    try {
      const stored = await this.repo.latestSession();
      if (!stored || this.snapshot.providerType) return; // nothing saved, or user already started
      const comments = await this.repo.listComments(stored.id, MAX_COMMENTS);
      const drafts = await this.orders.listDrafts(stored.id);
      const replies = await this.replyRepo.list(stored.id);
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
        drafts,
        replies,
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
      provider = this.deps.createLiveProvider?.() ?? new EulerProvider(createEulerBackend());
    }
    this.provider = provider;
    this.providerUnsubs = [
      provider.onStatusChange((status, reason) => {
        this.set({ status, statusReason: reason });
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
      drafts: [],
      replies: [],
      duplicates: 0,
      dropped: 0,
      startedAt: undefined,
      endedAt: undefined,
      providerType: provider.type,
      status: "CONNECTING",
      statusReason: undefined,
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
    // Comments -> order drafts (suggestions only; the seller decides).
    let drafts = this.snapshot.drafts;
    const changed = new Map<string, OrderDraft>();
    for (const event of accepted) {
      const result = applyComment(drafts, event, this.snapshot.catalog, {
        newId: this.deps.newDraftId ?? defaultDraftId,
      });
      drafts = result.drafts;
      if (result.changed) changed.set(result.changed.id, result.changed);
    }

    if (accepted.length || duplicates !== this.snapshot.duplicates) {
      this.set({ comments, dropped, duplicates, drafts });
    }
    if (accepted.length) {
      this.persist(() => this.repo.ingest(accepted));
      // Drafts are saved after their comments so the session row exists first.
      for (const d of changed.values()) this.persist(() => this.orders.saveDraft(d));
    }
    return accepted.length;
  }

  // ---- AI classification (opt-in: only when the seller presses the button) ----

  /** Label the newest unclassified comments (up to MAX_PER_RUN) with the seller's AI. */
  async classifyPending(): Promise<void> {
    if (this.snapshot.classifying) return;
    const config = (this.deps.loadAiConfig ?? loadAiConfig)();
    if (!config.provider) {
      this.set({ aiError: "NO_PROVIDER" });
      return;
    }
    const { sessionId } = this.snapshot;
    const pending = this.snapshot.comments.filter((c) => !c.intent).slice(-MAX_PER_RUN);
    if (pending.length === 0) return;
    const ai = (this.deps.ai ??= createAiClient());
    this.set({ classifying: true, aiError: undefined });
    try {
      for (let i = 0; i < pending.length; i += BATCH_SIZE) {
        const batch = pending.slice(i, i + BATCH_SIZE);
        let labels;
        try {
          labels = await classifyBatch(ai, config, batch, this.snapshot.catalog);
        } catch (e) {
          const code = (e as { code?: AiErrorCode }).code;
          this.set({ aiError: code ?? "NETWORK" });
          break;
        }
        if (this.snapshot.sessionId !== sessionId) break; // a new session started meanwhile
        const items = [...labels].map(([idx, l]) => ({
          eventId: batch[idx].eventId,
          source: batch[idx].source,
          intent: l.intent,
          confidence: l.confidence,
        }));
        if (items.length === 0) continue;
        const byKey = new Map(items.map((x) => [`${x.source}|${x.eventId}`, x]));
        this.set({
          comments: this.snapshot.comments.map((c) => {
            const hit = byKey.get(`${c.source}|${c.eventId}`);
            return hit ? { ...c, intent: hit.intent, intentConfidence: hit.confidence } : c;
          }),
        });
        this.persist(() => this.repo.setIntents(sessionId, items));
      }
    } finally {
      this.set({ classifying: false });
    }
  }

  // ---- reply suggestions (the seller edits, copies and posts them by hand) ----

  /** Ask the seller's AI for a reply draft to one comment. Never sends anything. */
  async suggestReply(eventId: string, source: string): Promise<void> {
    const comment = this.snapshot.comments.find(
      (c) => c.eventId === eventId && c.source === source,
    );
    if (!comment || this.snapshot.suggestingFor) return;
    const config = (this.deps.loadAiConfig ?? loadAiConfig)();
    if (!config.provider) {
      this.set({ aiError: "NO_PROVIDER" });
      return;
    }
    const { sessionId } = this.snapshot;
    const ai = (this.deps.ai ??= createAiClient());
    this.set({ suggestingFor: eventId, aiError: undefined });
    try {
      const answer = await ai.complete({
        provider: config.provider,
        model: config.models[config.provider],
        system: REPLY_SYSTEM,
        prompt: buildReplyPrompt(
          comment,
          this.snapshot.catalog,
          (this.deps.loadPolicy ?? loadPolicy)(),
        ),
        maxTokens: 300,
      });
      const text = cleanReply(answer);
      if (!text) {
        this.set({ aiError: "BAD_RESPONSE" });
        return;
      }
      if (this.snapshot.sessionId !== sessionId) return;
      const now = this.nowIso();
      const reply: ReplySuggestion = {
        id: (
          this.deps.newReplyId ??
          (() => `rs-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`)
        )(),
        sessionId,
        eventId,
        source,
        text,
        modelProvider: config.provider,
        modelName: config.models[config.provider],
        status: "DRAFT",
        approvedByUser: false,
        createdAt: now,
        updatedAt: now,
      };
      this.set({ replies: [...this.snapshot.replies, reply] });
      this.persist(() => this.replyRepo.create(reply));
    } catch (e) {
      this.set({ aiError: (e as { code?: AiErrorCode }).code ?? "NETWORK" });
    } finally {
      this.set({ suggestingFor: undefined });
    }
  }

  /** Edit the text (back to DRAFT) and/or mark COPIED or REJECTED. COPIED is not "sent". */
  updateReply(id: string, patch: { text?: string; status?: ReplyStatus }): boolean {
    const current = this.snapshot.replies.find((r) => r.id === id);
    if (!current) return false;
    const text = patch.text === undefined ? undefined : patch.text.trim();
    if (text === "") return false;
    const status = patch.status ?? (text !== undefined ? "DRAFT" : current.status);
    const now = this.nowIso();
    this.set({
      replies: this.snapshot.replies.map((r) =>
        r.id === id
          ? {
              ...r,
              text: text ?? r.text,
              status,
              approvedByUser: status === "COPIED",
              updatedAt: now,
            }
          : r,
      ),
    });
    this.persist(() => this.replyRepo.update(id, { text, status: patch.status }, now));
    return true;
  }

  // ---- catalog ----

  saveCatalogItem(item: CatalogItem): void {
    this.set({ catalog: mergeCatalog(this.snapshot.catalog, [item]) });
    this.persist(() => this.orders.upsertCatalogItem(item));
  }

  importCatalog(items: readonly CatalogItem[]): void {
    this.set({ catalog: mergeCatalog(this.snapshot.catalog, items) });
    for (const item of items) this.persist(() => this.orders.upsertCatalogItem(item));
  }

  deleteCatalogItem(sku: string): void {
    this.set({ catalog: this.snapshot.catalog.filter((c) => c.sku !== sku) });
    this.persist(() => this.orders.deleteCatalogItem(sku));
  }

  // ---- seller decisions ----

  /** Confirm or cancel a draft. Confirming is only allowed for a clean DRAFT. */
  setDraftStatus(id: string, status: OrderStatus): boolean {
    const draft = this.snapshot.drafts.find((d) => d.id === id);
    if (!draft || !canTransition(draft.status, status)) return false;
    const now = this.nowIso();
    this.set({
      drafts: this.snapshot.drafts.map((d) => (d.id === id ? { ...d, status, updatedAt: now } : d)),
    });
    this.persist(() => this.orders.setStatus(id, status, now));
    return true;
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
      statusReason: undefined,
      providerType: undefined,
      startedAt: undefined,
      endedAt: undefined,
      comments: [],
      catalog: [],
      drafts: [],
      replies: [],
      suggestingFor: undefined,
      duplicates: 0,
      dropped: 0,
      restored: false,
      classifying: false,
      aiError: undefined,
      persistError: false,
    };
  }

  private set(patch: Partial<LiveSessionSnapshot>): void {
    this.snapshot = { ...this.snapshot, ...patch };
    this.listeners.forEach((l) => l());
  }
}
