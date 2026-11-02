import { describe, expect, it } from "vitest";
import { classifyByRules } from "./commentRules";

describe("classifyByRules", () => {
  it("matches a Vietnamese purchase phrase even without diacritics", () => {
    expect(classifyByRules("den size M lay 2 cai", "vi").intent).toBe("PURCHASE");
    expect(classifyByRules("đen size M lấy 2 cái", "vi").intent).toBe("PURCHASE");
  });

  it("matches a Vietnamese product question", () => {
    expect(classifyByRules("còn màu đen không shop", "vi").intent).toBe("PRODUCT_QUESTION");
  });

  it("matches a Vietnamese general question", () => {
    expect(classifyByRules("ship về Đà Nẵng bao lâu thì tới", "vi").intent).toBe("QUESTION");
  });

  it("flags a spam/ad link ahead of any other keyword in the same comment", () => {
    expect(classifyByRules("mua ngay tại http://shop.example.com", "vi").intent).toBe("SPAM");
  });

  it("falls back to a low-confidence OTHER when nothing matches, for the review filter", () => {
    const r = classifyByRules("hihi dễ thương quá", "vi");
    expect(r.intent).toBe("OTHER");
    expect(r.confidence).toBeLessThan(0.6);
  });

  it("matches zh-TW scenarios the same way", () => {
    expect(classifyByRules("黑色 M 我要買", "zh-TW").intent).toBe("PURCHASE");
    expect(classifyByRules("還有黑色嗎", "zh-TW").intent).toBe("PRODUCT_QUESTION");
    expect(classifyByRules("運費多少", "zh-TW").intent).toBe("QUESTION");
  });
});
