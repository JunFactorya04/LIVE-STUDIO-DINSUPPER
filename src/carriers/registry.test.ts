import { describe, expect, it } from "vitest";
import { CARRIERS, SECRET_FIELDS, slotFor, statusOf } from "./registry";

describe("carriers", () => {
  it("builds keychain slots the backend accepts", () => {
    for (const c of CARRIERS) {
      for (const f of c.fields) expect(slotFor(c.id, f)).toMatch(/^carrier-[a-z0-9-]{3,40}$/);
    }
  });
  it("never reports a carrier as connected, only saved", () => {
    const ecpay = CARRIERS.find((c) => c.id === "ecpay")!;
    expect(statusOf(ecpay, new Set())).toBe("none");
    expect(statusOf(ecpay, new Set(["merchantId"]))).toBe("partial");
    expect(statusOf(ecpay, new Set(["merchantId", "hashKey", "hashIv"]))).toBe("saved");
  });
  it("shows the Excel export of 7-ELEVEN as ready", () => {
    expect(
      statusOf(
        CARRIERS.find((c) => c.id === "seven")!,
        new Set(),
      ),
    ).toBe("excel");
  });
  it("treats keys and passwords as secrets", () => {
    expect(SECRET_FIELDS.has("hashKey")).toBe(true);
    expect(SECRET_FIELDS.has("account")).toBe(false);
  });
});
