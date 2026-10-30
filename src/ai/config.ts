// Which AI service the seller uses and which model. Not secret, so it lives in localStorage.
// The keys themselves are in the OS keychain (see ../secrets).

export const AI_PROVIDERS = ["openai", "claude", "gemini", "deepseek"] as const;
export type AiProviderId = (typeof AI_PROVIDERS)[number];

/** Shown as placeholders only; the real defaults live in src-tauri/src/ai.rs. */
export const DEFAULT_MODELS: Record<AiProviderId, string> = {
  openai: "gpt-4o-mini",
  claude: "claude-haiku-5-5",
  gemini: "gemini-2.5-flash",
  deepseek: "deepseek-chat",
};

export interface AiConfig {
  provider?: AiProviderId;
  models: Partial<Record<AiProviderId, string>>;
}

const KEY = "live-studio.ai";
const EMPTY: AiConfig = { models: {} };

export function loadAiConfig(): AiConfig {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(KEY) ?? "null");
    if (typeof raw !== "object" || raw === null) return EMPTY;
    const r = raw as { provider?: unknown; models?: unknown };
    const provider = AI_PROVIDERS.find((p) => p === r.provider);
    const models: AiConfig["models"] = {};
    if (typeof r.models === "object" && r.models !== null) {
      for (const p of AI_PROVIDERS) {
        const m = (r.models as Record<string, unknown>)[p];
        if (typeof m === "string" && m.trim()) models[p] = m.trim();
      }
    }
    return { provider, models };
  } catch {
    return EMPTY;
  }
}

export function saveAiConfig(config: AiConfig): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(config));
  } catch {
    // not persisted; the choice still applies for this run
  }
}
