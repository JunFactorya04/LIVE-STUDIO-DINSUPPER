import { BaseLiveProvider } from "./provider";
import { parsePastedChat } from "./paste";
import type { LiveCommentEvent, LiveSessionConfig } from "./types";

// Source for chat the seller pastes from their own screen. It needs no account, no credentials
// and no third party, and it never claims to be a live connection: its status is MANUAL.
export class ManualPasteProvider extends BaseLiveProvider {
  readonly type = "manual";
  private sessionId: string | undefined;

  async connect(config: LiveSessionConfig): Promise<void> {
    this.sessionId = config.sessionId;
    this.setStatus("MANUAL");
  }

  async disconnect(): Promise<void> {
    this.sessionId = undefined;
    this.setStatus("DISCONNECTED");
  }

  /**
   * Parse pasted text into events for the current session. They are returned (not emitted one by
   * one) so the store can ingest the whole paste as one batch and one database write.
   */
  parse(text: string, now?: Date): LiveCommentEvent[] {
    return this.sessionId ? parsePastedChat(text, this.sessionId, now) : [];
  }
}
