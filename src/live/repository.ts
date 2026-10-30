import { hasBackend } from "../platform/backend";
import type { CommentIntent, LiveCommentEvent, LiveCommentSource } from "./types";

// Persistence boundary. In the desktop app it is SQLite behind Tauri commands; in a plain
// browser (npm run dev) and in tests it is an in-memory copy with the same behaviour.

export interface StoredSession {
  id: string;
  liveUrl?: string;
  username?: string;
  providerType: string;
  status: string;
  startedAt?: string;
  endedAt?: string;
}

export interface SessionPatch {
  status?: string;
  startedAt?: string;
  endedAt?: string;
}

export interface LiveRepository {
  createSession(
    s: Pick<StoredSession, "id" | "liveUrl" | "username" | "providerType" | "status">,
  ): Promise<void>;
  updateSession(id: string, patch: SessionPatch): Promise<void>;
  latestSession(): Promise<StoredSession | undefined>;
  ingest(events: readonly LiveCommentEvent[]): Promise<number>;
  listComments(sessionId: string, limit: number): Promise<LiveCommentEvent[]>;
  deleteComments(sessionId: string): Promise<void>;
  setIntents(
    sessionId: string,
    items: readonly {
      eventId: string;
      source: string;
      intent: CommentIntent;
      confidence: number;
    }[],
  ): Promise<void>;
}

export class MemoryLiveRepository implements LiveRepository {
  private sessions: StoredSession[] = [];
  private comments: LiveCommentEvent[] = [];

  async createSession(s: Parameters<LiveRepository["createSession"]>[0]): Promise<void> {
    this.sessions.push({ ...s });
  }

  async updateSession(id: string, patch: SessionPatch): Promise<void> {
    const s = this.sessions.find((x) => x.id === id);
    if (!s) return;
    if (patch.status !== undefined) s.status = patch.status;
    if (patch.startedAt !== undefined) s.startedAt = patch.startedAt;
    if (patch.endedAt !== undefined) s.endedAt = patch.endedAt;
  }

  async latestSession(): Promise<StoredSession | undefined> {
    const s = this.sessions[this.sessions.length - 1];
    return s ? { ...s } : undefined;
  }

  async ingest(events: readonly LiveCommentEvent[]): Promise<number> {
    let added = 0;
    for (const e of events) {
      if (!e.commentText.trim()) continue;
      const dup = this.comments.some(
        (c) => c.sessionId === e.sessionId && c.source === e.source && c.eventId === e.eventId,
      );
      if (dup) continue;
      this.comments.push({ ...e });
      added += 1;
    }
    return added;
  }

  async listComments(sessionId: string, limit: number): Promise<LiveCommentEvent[]> {
    return this.comments.filter((c) => c.sessionId === sessionId).slice(-limit);
  }

  async deleteComments(sessionId: string): Promise<void> {
    this.comments = this.comments.filter((c) => c.sessionId !== sessionId);
  }

  async setIntents(
    sessionId: string,
    items: Parameters<LiveRepository["setIntents"]>[1],
  ): Promise<void> {
    for (const i of items) {
      const c = this.comments.find(
        (x) => x.sessionId === sessionId && x.eventId === i.eventId && x.source === i.source,
      );
      if (c) {
        c.intent = i.intent;
        c.intentConfidence = i.confidence;
      }
    }
  }
}

interface CommentDto {
  eventId: string;
  sessionId: string;
  username?: string | null;
  commentText: string;
  commentTimestamp: string;
  receivedAt: string;
  source: string;
  intent?: string | null;
  intentConfidence?: number | null;
}

interface SessionDto {
  id: string;
  liveUrl?: string | null;
  username?: string | null;
  providerType: string;
  status: string;
  startedAt?: string | null;
  endedAt?: string | null;
}

const opt = <T>(v: T | null | undefined): T | undefined => v ?? undefined;

export class TauriLiveRepository implements LiveRepository {
  private async call<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
    const { invoke } = await import("../platform/backend");
    return invoke<T>(cmd, args);
  }

  createSession(s: Parameters<LiveRepository["createSession"]>[0]): Promise<void> {
    return this.call("live_create_session", { session: s });
  }

  updateSession(id: string, patch: SessionPatch): Promise<void> {
    return this.call("live_update_session", { id, patch });
  }

  async latestSession(): Promise<StoredSession | undefined> {
    const s = await this.call<SessionDto | null>("live_latest_session");
    if (!s) return undefined;
    return {
      id: s.id,
      liveUrl: opt(s.liveUrl),
      username: opt(s.username),
      providerType: s.providerType,
      status: s.status,
      startedAt: opt(s.startedAt),
      endedAt: opt(s.endedAt),
    };
  }

  ingest(events: readonly LiveCommentEvent[]): Promise<number> {
    const comments: CommentDto[] = events.map((e) => ({
      eventId: e.eventId,
      sessionId: e.sessionId,
      username: e.username ?? null,
      commentText: e.commentText,
      commentTimestamp: e.commentTimestamp,
      receivedAt: e.receivedAt,
      source: e.source,
    }));
    return this.call("live_ingest_comments", { comments });
  }

  async listComments(sessionId: string, limit: number): Promise<LiveCommentEvent[]> {
    const rows = await this.call<CommentDto[]>("live_list_comments", { sessionId, limit });
    return rows.map((r) => ({
      eventId: r.eventId,
      platform: "tiktok",
      sessionId: r.sessionId,
      username: opt(r.username),
      commentText: r.commentText,
      commentTimestamp: r.commentTimestamp,
      receivedAt: r.receivedAt,
      source: r.source as LiveCommentSource,
      intent: opt(r.intent) as CommentIntent | undefined,
      intentConfidence: opt(r.intentConfidence),
    }));
  }

  async deleteComments(sessionId: string): Promise<void> {
    await this.call<number>("live_delete_comments", { sessionId });
  }

  async setIntents(
    sessionId: string,
    items: Parameters<LiveRepository["setIntents"]>[1],
  ): Promise<void> {
    await this.call<number>("live_set_intents", { sessionId, items });
  }
}

/** True when commands can run: in the desktop app, or on a phone opened from the sharing link. */
export const isTauri = (): boolean => hasBackend();

export function createRepository(): LiveRepository {
  return isTauri() ? new TauriLiveRepository() : new MemoryLiveRepository();
}
