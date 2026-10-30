import { describe, expect, it } from "vitest";
import { validateLiveConfig } from "./config";

describe("validateLiveConfig", () => {
  it("rejects when both URL and username are empty", () => {
    const r = validateLiveConfig("", "  ");
    expect(r.ok).toBe(false);
    expect(r.issues).toEqual(["NEED_URL_OR_USERNAME"]);
  });

  it("rejects malformed or foreign URLs", () => {
    for (const bad of [
      "not a url",
      "https://example.com/@shop/live",
      "https://www.tiktok.com/@shop",
      "https://www.tiktok.com/@shop/video/123",
      "ftp://www.tiktok.com/@shop/live",
      "https://eviltiktok.com/@shop/live",
    ]) {
      const r = validateLiveConfig(bad, "");
      expect(r.ok, bad).toBe(false);
      expect(r.issues, bad).toContain("URL_FORMAT");
    }
  });

  it("accepts a LIVE URL and derives the username from it", () => {
    const r = validateLiveConfig("https://www.tiktok.com/@my.shop_01/live/", "");
    expect(r.ok).toBe(true);
    expect(r.username).toBe("my.shop_01");
    expect(r.liveUrl).toBe("https://www.tiktok.com/@my.shop_01/live");
  });

  it("accepts a username with or without @", () => {
    expect(validateLiveConfig("", "@shop_tw").username).toBe("shop_tw");
    expect(validateLiveConfig("", "shop_tw").ok).toBe(true);
  });

  it("rejects invalid usernames", () => {
    for (const bad of ["a", "has space", "bad/name", "x".repeat(40)]) {
      const r = validateLiveConfig("", bad);
      expect(r.ok, bad).toBe(false);
      expect(r.issues, bad).toContain("USERNAME_FORMAT");
    }
  });
});
