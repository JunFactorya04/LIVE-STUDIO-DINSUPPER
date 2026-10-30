import { BaseLiveProvider } from "./provider";
import type { LiveSessionConfig } from "./types";

// Development/test only. Every event it emits is labelled source "DEMO" and the
// provider reports status "DEMO", never "CONNECTED".

const DEMO_USERS = ["demo_amy", "demo_bob", "demo_chi", "demo_dung"];

// Mixed zh-TW / vi / emoji / special characters, matching the required test cases.
export const DEMO_SCRIPT = [
  "A12",
  "黑色 M",
  "兩件",
  "請問還有現貨嗎？",
  "Giá bao nhiêu vậy shop ơi 😍",
  "我要 B07 白色 L ×1",
  "運費多少？",
  "🔥🔥🔥",
  "Cho mình 2 cái nhé!!",
];

export interface DemoProviderOptions {
  intervalMs?: number;
  script?: string[];
  now?: () => Date;
}

export class DemoLiveCommentProvider extends BaseLiveProvider {
  readonly type = "demo";
  private timer: ReturnType<typeof setInterval> | undefined;
  private counter = 0;
  private activeSession: string | undefined;

  constructor(private readonly options: DemoProviderOptions = {}) {
    super();
  }

  async connect(config: LiveSessionConfig): Promise<void> {
    this.stop();
    this.activeSession = config.sessionId;
    this.setStatus("CONNECTING");
    await Promise.resolve();
    if (this.activeSession !== config.sessionId) return; // disconnected meanwhile
    this.setStatus("DEMO");

    const script = this.options.script ?? DEMO_SCRIPT;
    const now = this.options.now ?? (() => new Date());
    this.timer = setInterval(() => {
      const n = this.counter++;
      const stamp = now().toISOString();
      this.emit({
        eventId: `demo-${config.sessionId}-${n}`,
        platform: "tiktok",
        sessionId: config.sessionId,
        username: DEMO_USERS[n % DEMO_USERS.length],
        commentText: script[n % script.length],
        commentTimestamp: stamp,
        receivedAt: stamp,
        source: "DEMO",
      });
    }, this.options.intervalMs ?? 1800);
  }

  async disconnect(sessionId: string): Promise<void> {
    if (this.activeSession !== sessionId) return;
    this.stop();
    this.activeSession = undefined;
    this.setStatus("DISCONNECTED");
  }

  private stop(): void {
    if (this.timer !== undefined) clearInterval(this.timer);
    this.timer = undefined;
  }
}
