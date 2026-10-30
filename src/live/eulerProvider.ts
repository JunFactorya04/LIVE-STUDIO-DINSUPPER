import { BaseLiveProvider } from "./provider";
import { isTauri } from "./repository";
import type { LiveCommentEvent, LiveProviderStatus, LiveSessionConfig } from "./types";

// Comment source backed by Euler Stream, a THIRD-PARTY service that is not TikTok and is not
// endorsed by it. The WebSocket lives in Rust (src-tauri/src/euler.rs) because the API key is
// kept in the OS keychain and never reaches the frontend. This class only turns the events Rust
// emits into the LiveCommentProvider contract.
//
// Rules: CONNECTED is reported only when Rust relays proof from the service; with no key, in a
// plain browser, or on any failure the status is UNAVAILABLE / ERROR / DISCONNECTED with a reason.

export interface EulerComment {
  eventId: string;
  username?: string | null;
  displayName?: string | null;
  commentText: string;
  commentTimestampMs?: number | null;
}

export type EulerEnvelope = { sessionId: string } & (
  | { kind: "status"; status: LiveProviderStatus; code?: number | null; reason?: string | null }
  | { kind: "comments"; comments: EulerComment[] }
);

export interface EulerBackend {
  connect(sessionId: string, uniqueId: string): Promise<void>;
  disconnect(): Promise<void>;
  /** Resolves to an unsubscribe function once the listener is registered. */
  subscribe(handler: (e: EulerEnvelope) => void): Promise<() => void>;
}

export class TauriEulerBackend implements EulerBackend {
  async connect(sessionId: string, uniqueId: string): Promise<void> {
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke("euler_connect", { sessionId, uniqueId });
  }

  async disconnect(): Promise<void> {
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke("euler_disconnect");
  }

  async subscribe(handler: (e: EulerEnvelope) => void): Promise<() => void> {
    const { listen } = await import("@tauri-apps/api/event");
    return listen<EulerEnvelope>("euler-event", (e) => handler(e.payload));
  }
}

/** undefined outside the desktop app: the provider then reports UNAVAILABLE (reason BROWSER). */
export const createEulerBackend = (): EulerBackend | undefined =>
  isTauri() ? new TauriEulerBackend() : undefined;

export function toCommentEvent(
  c: EulerComment,
  sessionId: string,
  receivedAt: Date,
): LiveCommentEvent {
  const ts = c.commentTimestampMs ? new Date(c.commentTimestampMs) : receivedAt;
  return {
    eventId: c.eventId,
    platform: "tiktok",
    sessionId,
    username: c.username ?? undefined,
    displayName: c.displayName ?? undefined,
    commentText: c.commentText,
    commentTimestamp: ts.toISOString(),
    receivedAt: receivedAt.toISOString(),
    source: "UNOFFICIAL_CONNECTOR",
  };
}

export class EulerProvider extends BaseLiveProvider {
  readonly type = "euler";
  private sessionId: string | undefined;
  private unsubscribe: (() => void) | undefined;

  constructor(
    private readonly backend: EulerBackend | undefined,
    private readonly now: () => Date = () => new Date(),
  ) {
    super();
  }

  async connect(config: LiveSessionConfig): Promise<void> {
    this.sessionId = config.sessionId;
    if (!this.backend) {
      this.setStatus("UNAVAILABLE", "BROWSER");
      return;
    }
    if (!config.username) {
      this.setStatus("ERROR", "INVALID_OPTIONS");
      return;
    }
    this.setStatus("CONNECTING");
    this.unsubscribe = await this.backend.subscribe((e) => this.onEvent(e));
    await this.backend.connect(config.sessionId, config.username);
  }

  async disconnect(sessionId: string): Promise<void> {
    if (this.sessionId !== sessionId) return;
    this.sessionId = undefined;
    this.unsubscribe?.();
    this.unsubscribe = undefined;
    await this.backend?.disconnect();
    this.setStatus("DISCONNECTED");
  }

  private onEvent(e: EulerEnvelope): void {
    if (e.sessionId !== this.sessionId) return;
    if (e.kind === "status") {
      this.setStatus(e.status, e.reason ?? undefined);
    } else {
      const at = this.now();
      e.comments.forEach((c) => this.emit(toCommentEvent(c, e.sessionId, at)));
    }
  }
}
