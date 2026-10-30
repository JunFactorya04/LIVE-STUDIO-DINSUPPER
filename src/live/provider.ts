import type { LiveCommentEvent, LiveProviderStatus, LiveSessionConfig } from "./types";

// The UI and AI pipeline depend only on this interface, never on a specific
// TikTok library. Swap the source by swapping the provider.
export interface LiveCommentProvider {
  /** Short identifier stored with the session, e.g. "demo" or "none". */
  readonly type: string;
  getStatus(): Promise<LiveProviderStatus>;
  connect(config: LiveSessionConfig): Promise<void>;
  disconnect(sessionId: string): Promise<void>;
  onComment(handler: (event: LiveCommentEvent) => void): () => void;
  /** Added to the spec interface so the UI can reflect real status changes. */
  onStatusChange(handler: StatusHandler): () => void;
}

/** `reason` is a stable key the UI translates (e.g. "NOT_LIVE", "INVALID_AUTH"). */
export type StatusHandler = (status: LiveProviderStatus, reason?: string) => void;

export abstract class BaseLiveProvider implements LiveCommentProvider {
  abstract readonly type: string;
  protected status: LiveProviderStatus = "DISCONNECTED";
  private commentHandlers = new Set<(event: LiveCommentEvent) => void>();
  private statusHandlers = new Set<StatusHandler>();

  abstract connect(config: LiveSessionConfig): Promise<void>;
  abstract disconnect(sessionId: string): Promise<void>;

  async getStatus(): Promise<LiveProviderStatus> {
    return this.status;
  }

  onComment(handler: (event: LiveCommentEvent) => void): () => void {
    this.commentHandlers.add(handler);
    return () => this.commentHandlers.delete(handler);
  }

  onStatusChange(handler: StatusHandler): () => void {
    this.statusHandlers.add(handler);
    return () => this.statusHandlers.delete(handler);
  }

  protected setStatus(status: LiveProviderStatus, reason?: string): void {
    if (this.status === status && reason === undefined) return;
    this.status = status;
    this.statusHandlers.forEach((h) => h(status, reason));
  }

  protected emit(event: LiveCommentEvent): void {
    this.commentHandlers.forEach((h) => h(event));
  }
}
