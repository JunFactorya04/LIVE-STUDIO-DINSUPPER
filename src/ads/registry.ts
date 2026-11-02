// The three ad platforms this tab can read/control, and which credential fields each one needs.
// Nothing here calls a network: it is the shape secrets/client.ts and AdsPage.tsx build on,
// mirroring carriers/registry.ts for shipping carriers.

export type AdPlatformId = "tiktok" | "meta" | "google";

export type AdField =
  | "accessToken"
  | "advertiserId"
  | "adAccountId"
  | "developerToken"
  | "clientId"
  | "clientSecret"
  | "refreshToken"
  | "customerId";

/** Fields that hold secrets are written as password inputs and can never be read back. */
export const SECRET_FIELDS: ReadonlySet<AdField> = new Set([
  "accessToken",
  "clientSecret",
  "refreshToken",
  "developerToken",
]);

export interface AdPlatform {
  id: AdPlatformId;
  zh: string;
  vi: string;
  /** Letters on the tile — no real brand logo is used here. */
  mark: string;
  tone: "blue" | "green" | "orange" | "red" | "purple" | "teal" | "indigo";
  /** The platform's own developer-app registration page, opened in the browser. */
  consoleUrl: string;
  fields: AdField[];
}

export const AD_PLATFORMS: AdPlatform[] = [
  {
    id: "tiktok",
    zh: "TikTok 廣告管理",
    vi: "TikTok Ads (For Business)",
    mark: "TT",
    tone: "red",
    consoleUrl: "https://ads.tiktok.com/marketing_api/homepage",
    fields: ["accessToken", "advertiserId"],
  },
  {
    id: "meta",
    zh: "Meta 廣告管理",
    vi: "Meta Ads (Facebook/Instagram)",
    mark: "M",
    tone: "blue",
    consoleUrl: "https://developers.facebook.com/apps/",
    fields: ["accessToken", "adAccountId"],
  },
  {
    id: "google",
    zh: "Google Ads",
    vi: "Google Ads",
    mark: "G",
    tone: "green",
    consoleUrl: "https://ads.google.com/aw/apicenter",
    fields: ["developerToken", "clientId", "clientSecret", "refreshToken", "customerId"],
  },
];

export const slotFor = (platform: AdPlatformId, field: AdField): `ads-${string}` =>
  `ads-${platform}-${field.toLowerCase()}`;

export type AdConnectionStatus = "none" | "partial" | "saved" | "verified";

/** From which fields are filled, and whether a live check already succeeded. */
export function statusOf(
  p: AdPlatform,
  filled: ReadonlySet<AdField>,
  verified: boolean,
): AdConnectionStatus {
  if (verified) return "verified";
  const n = p.fields.filter((f) => filled.has(f)).length;
  if (n === 0) return "none";
  return n === p.fields.length ? "saved" : "partial";
}
