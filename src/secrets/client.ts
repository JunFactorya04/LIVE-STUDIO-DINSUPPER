import { isTauri } from "../live/repository";

// API keys the seller registers (BYOK). The keys live in the OS Keychain / Credential Manager,
// written by Rust. This client can set, remove and ask "is it set"; there is no way to read one.

export const SECRET_SLOTS = ["claude", "openai", "gemini", "deepseek", "connector"] as const;
/** A fixed slot, `carrier-<carrier>-<field>` for a shipping carrier, or `ads-<platform>-<field>`
 *  for an ad platform credential (see src/ads/registry.ts). */
export type FixedSecretSlot = (typeof SECRET_SLOTS)[number];
export type SecretSlot = FixedSecretSlot | `carrier-${string}` | `ads-${string}`;

export interface SecretsClient {
  /** False in a plain browser: keys are only stored by the desktop app. */
  readonly available: boolean;
  exists(slot: SecretSlot): Promise<boolean>;
  set(slot: SecretSlot, value: string): Promise<void>;
  remove(slot: SecretSlot): Promise<void>;
}

async function invoke<T>(cmd: string, args: Record<string, unknown>): Promise<T> {
  const { invoke } = await import("../platform/backend");
  return invoke<T>(cmd, args);
}

export const tauriSecrets: SecretsClient = {
  available: true,
  exists: (slot) => invoke<boolean>("secret_exists", { slot }),
  set: (slot, value) => invoke<void>("secret_set", { slot, value }),
  remove: (slot) => invoke<void>("secret_remove", { slot }),
};

export const unavailableSecrets: SecretsClient = {
  available: false,
  exists: async () => false,
  set: async () => {
    throw new Error("SECRETS_UNAVAILABLE");
  },
  remove: async () => undefined,
};

export const createSecretsClient = (): SecretsClient =>
  isTauri() ? tauriSecrets : unavailableSecrets;
