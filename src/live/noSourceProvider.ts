import { BaseLiveProvider } from "./provider";
import type { LiveSessionConfig } from "./types";

// Placeholder used when no verified live source is installed. It never produces
// comments and never reports CONNECTED: it ends in UNAVAILABLE so the UI can
// explain that a real provider is required (spec section 3.4 and Phase 5).
export class NoSourceProvider extends BaseLiveProvider {
  readonly type = "none";
  private activeSession: string | undefined;

  async connect(config: LiveSessionConfig): Promise<void> {
    this.activeSession = config.sessionId;
    this.setStatus("CONNECTING");
    await Promise.resolve();
    if (this.activeSession !== config.sessionId) return;
    this.setStatus("UNAVAILABLE");
  }

  async disconnect(sessionId: string): Promise<void> {
    if (this.activeSession !== sessionId) return;
    this.activeSession = undefined;
    this.setStatus("DISCONNECTED");
  }
}
