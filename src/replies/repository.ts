import { isTauri } from "../live/repository";
import type { ReplyStatus, ReplySuggestion } from "./types";

export interface ReplyRepository {
  create(reply: ReplySuggestion): Promise<void>;
  list(sessionId: string): Promise<ReplySuggestion[]>;
  update(id: string, patch: { text?: string; status?: ReplyStatus }, now: string): Promise<boolean>;
}

export class MemoryReplyRepository implements ReplyRepository {
  private rows = new Map<string, ReplySuggestion>();

  async create(r: ReplySuggestion): Promise<void> {
    // A new suggestion is always an unapproved draft, whatever the caller passes.
    this.rows.set(r.id, { ...r, status: "DRAFT", approvedByUser: false });
  }
  async list(sessionId: string): Promise<ReplySuggestion[]> {
    return [...this.rows.values()].filter((r) => r.sessionId === sessionId).map((r) => ({ ...r }));
  }
  async update(id: string, patch: { text?: string; status?: ReplyStatus }, now: string) {
    const r = this.rows.get(id);
    if (!r) return false;
    const status = patch.status ?? (patch.text !== undefined ? "DRAFT" : r.status);
    this.rows.set(id, {
      ...r,
      text: patch.text ?? r.text,
      status,
      approvedByUser: status === "COPIED",
      updatedAt: now,
    });
    return true;
  }
}

interface ReplyDto {
  id: string;
  sessionId: string;
  eventId: string;
  source: string;
  suggestedText: string;
  modelProvider?: string | null;
  modelName?: string | null;
  status: string;
  approvedByUser: boolean;
  createdAt: string;
  updatedAt: string;
}

export class TauriReplyRepository implements ReplyRepository {
  private async call<T>(cmd: string, args: Record<string, unknown>): Promise<T> {
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke<T>(cmd, args);
  }
  create(r: ReplySuggestion): Promise<void> {
    const reply: ReplyDto = {
      id: r.id,
      sessionId: r.sessionId,
      eventId: r.eventId,
      source: r.source,
      suggestedText: r.text,
      modelProvider: r.modelProvider ?? null,
      modelName: r.modelName ?? null,
      status: "DRAFT",
      approvedByUser: false,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
    };
    return this.call("reply_create", { reply });
  }
  async list(sessionId: string): Promise<ReplySuggestion[]> {
    const rows = await this.call<ReplyDto[]>("reply_list", { sessionId });
    return rows.map((r) => ({
      id: r.id,
      sessionId: r.sessionId,
      eventId: r.eventId,
      source: r.source,
      text: r.suggestedText,
      modelProvider: r.modelProvider ?? undefined,
      modelName: r.modelName ?? undefined,
      status: r.status === "COPIED" || r.status === "REJECTED" ? r.status : "DRAFT",
      approvedByUser: r.approvedByUser,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
    }));
  }
  update(id: string, patch: { text?: string; status?: ReplyStatus }, now: string) {
    return this.call<boolean>("reply_update", {
      id,
      text: patch.text ?? null,
      status: patch.status ?? null,
      now,
    });
  }
}

export const createReplyRepository = (): ReplyRepository =>
  isTauri() ? new TauriReplyRepository() : new MemoryReplyRepository();
