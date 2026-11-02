import { describe, expect, it } from "vitest";
import { AD_PLATFORMS, slotFor, statusOf, type AdField } from "./registry";

describe("ads/registry", () => {
  it("slotFor is lower-case and prefixed with ads-<platform>-", () => {
    expect(slotFor("tiktok", "accessToken")).toBe("ads-tiktok-accesstoken");
    expect(slotFor("google", "clientSecret")).toBe("ads-google-clientsecret");
  });

  it("statusOf reflects filled fields and the verified flag", () => {
    const tiktok = AD_PLATFORMS.find((p) => p.id === "tiktok")!;
    expect(statusOf(tiktok, new Set(), false)).toBe("none");
    expect(statusOf(tiktok, new Set<AdField>(["accessToken"]), false)).toBe("partial");
    expect(statusOf(tiktok, new Set<AdField>(tiktok.fields), false)).toBe("saved");
    expect(statusOf(tiktok, new Set<AdField>(tiktok.fields), true)).toBe("verified");
  });

  it("every platform has at least one field and a tile mark", () => {
    for (const p of AD_PLATFORMS) {
      expect(p.fields.length).toBeGreaterThan(0);
      expect(p.mark.length).toBeGreaterThan(0);
    }
  });
});
