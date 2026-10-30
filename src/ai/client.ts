import { isTauri } from "../live/repository";
import type { AiProviderId } from "./config";

// Calls an AI service through Rust, which reads the seller's key from the keychain.
// A failure is one of these short codes (never the key or the vendor's message).

export const AI_ERROR_CODES = [
  "UNKNOWN_PROVIDER",
  "BAD_MODEL",
  "TOO_LONG",
  "NO_KEY",
  "AUTH",
  "QUOTA",
  "RATE_LIMIT",
  "BAD_REQUEST",
  "SERVER",
  "TIMEOUT",
  "NETWORK",
  "BAD_RESPONSE",
  "KEYCHAIN",
  "NOT_DESKTOP",
] as const;
export type AiErrorCode = (typeof AI_ERROR_CODES)[number];

export interface AiClient {
  /** False in a plain browser: AI calls need the desktop app (keys live in the keychain). */
  readonly available: boolean;
  complete(req: {
    provider: AiProviderId;
    model?: string;
    system: string;
    prompt: string;
    maxTokens?: number;
  }): Promise<string>;
}

export class AiError extends Error {
  constructor(readonly code: AiErrorCode) {
    super(code);
  }
}

const toCode = (e: unknown): AiErrorCode => AI_ERROR_CODES.find((c) => c === e) ?? "NETWORK";

export const tauriAi: AiClient = {
  available: true,
  async complete({ provider, model, system, prompt, maxTokens }) {
    const { invoke } = await import("../platform/backend");
    try {
      return await invoke<string>("ai_complete", { provider, model, system, prompt, maxTokens });
    } catch (e) {
      throw new AiError(toCode(e));
    }
  },
};

export const unavailableAi: AiClient = {
  available: false,
  async complete() {
    throw new AiError("NOT_DESKTOP");
  },
};

export const createAiClient = (): AiClient => (isTauri() ? tauriAi : unavailableAi);
