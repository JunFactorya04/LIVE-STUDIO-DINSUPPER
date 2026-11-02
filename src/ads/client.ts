import { isTauri } from "../live/repository";
import type { AdPlatformId } from "./registry";

// Calls the seller's own ad accounts through Rust (TikTok for Business / Meta / Google Ads),
// which reads the saved token from the keychain. A failure is one of these short codes.

export const ADS_ERROR_CODES = [
  "UNKNOWN_PLATFORM",
  "NOT_CONFIGURED",
  "AUTH",
  "RATE_LIMIT",
  "NETWORK",
  "API_ERROR",
  "NOT_DESKTOP",
] as const;
export type AdsErrorCode = (typeof ADS_ERROR_CODES)[number];

export interface AdStats {
  spend: number;
  impressions: number;
  clicks: number;
  conversions: number;
  currency: string;
}

export type CampaignStatus = "ENABLED" | "PAUSED" | "OTHER";

export interface AdCampaign {
  id: string;
  name: string;
  status: CampaignStatus;
  dailyBudget?: number;
}

export class AdsError extends Error {
  constructor(readonly code: AdsErrorCode) {
    super(code);
  }
}

const toCode = (e: unknown): AdsErrorCode => ADS_ERROR_CODES.find((c) => c === e) ?? "NETWORK";

export interface AdsClient {
  readonly available: boolean;
  stats(platform: AdPlatformId): Promise<AdStats>;
  campaigns(platform: AdPlatformId): Promise<AdCampaign[]>;
  setCampaignStatus(platform: AdPlatformId, campaignId: string, enabled: boolean): Promise<void>;
}

export const tauriAds: AdsClient = {
  available: true,
  async stats(platform) {
    const { invoke } = await import("../platform/backend");
    try {
      return await invoke<AdStats>("ads_stats", { platform });
    } catch (e) {
      throw new AdsError(toCode(e));
    }
  },
  async campaigns(platform) {
    const { invoke } = await import("../platform/backend");
    try {
      return await invoke<AdCampaign[]>("ads_campaigns", { platform });
    } catch (e) {
      throw new AdsError(toCode(e));
    }
  },
  async setCampaignStatus(platform, campaignId, enabled) {
    const { invoke } = await import("../platform/backend");
    try {
      await invoke<void>("ads_set_campaign_status", { platform, campaignId, enabled });
    } catch (e) {
      throw new AdsError(toCode(e));
    }
  },
};

export const unavailableAds: AdsClient = {
  available: false,
  async stats() {
    throw new AdsError("NOT_DESKTOP");
  },
  async campaigns() {
    throw new AdsError("NOT_DESKTOP");
  },
  async setCampaignStatus() {
    throw new AdsError("NOT_DESKTOP");
  },
};

export const createAdsClient = (): AdsClient => (isTauri() ? tauriAds : unavailableAds);
