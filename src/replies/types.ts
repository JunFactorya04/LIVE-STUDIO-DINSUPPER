// Reply suggestions are drafts for the seller. There is deliberately no "SENT" status: the app
// has no way to send a reply to TikTok, and copying a reply never counts as sending it.

export type ReplyStatus = "DRAFT" | "COPIED" | "REJECTED";

export interface ReplySuggestion {
  id: string;
  sessionId: string;
  /** The comment this answers (event id + source identify it inside a session). */
  eventId: string;
  source: string;
  text: string;
  modelProvider?: string;
  modelName?: string;
  status: ReplyStatus;
  approvedByUser: boolean;
  createdAt: string;
  updatedAt: string;
}
