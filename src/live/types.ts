// Types for the TikTok LIVE Assistant (docs/TIKTOK_LIVE_ASSISTANT.md, section 3).

export type LiveProviderStatus =
  "DISCONNECTED" | "CONNECTING" | "CONNECTED" | "UNAVAILABLE" | "DEMO" | "MANUAL" | "ERROR";

export type LiveCommentSource =
  | "OFFICIAL_API"
  | "APPROVED_CONNECTOR"
  | "OCR"
  | "DEMO"
  | "MANUAL"
  /** Third-party service that is not TikTok (currently Euler Stream). */
  | "UNOFFICIAL_CONNECTOR";

export interface LiveSessionConfig {
  sessionId: string;
  liveUrl?: string;
  username?: string;
}

export interface LiveCommentEvent {
  eventId: string;
  platform: "tiktok";
  sessionId: string;
  platformUserId?: string;
  username?: string;
  displayName?: string;
  commentText: string;
  commentTimestamp: string;
  receivedAt: string;
  source: LiveCommentSource;
  sourceConfidence?: number;
  rawPayloadRef?: string;
}
