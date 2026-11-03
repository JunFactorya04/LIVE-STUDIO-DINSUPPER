import { describe, expect, it } from "vitest";
import { guessAddress } from "./storeAddress";

const short = (g: ReturnType<typeof guessAddress>) =>
  g.areas.map((a) => a.city.zh + a.district).join(",");

describe("guessAddress", () => {
  it("reads city, district and road from a full address", () => {
    const g = guessAddress("台南市新化區中正路12號");
    expect(short(g)).toBe("台南市新化區");
    expect(g.road).toBe("中正路");
  });

  it("works without the city or the 區 ending, and with 臺", () => {
    expect(short(guessAddress("新化中正路"))).toBe("台南市新化區");
    expect(guessAddress("中正路").areas).toHaveLength(0);
    expect(guessAddress("臺北市信義區忠孝東路五段2號").road).toBe("忠孝東路五段");
  });

  it("offers every city for a district name they share, and the city alone when no district", () => {
    expect(guessAddress("信義區").areas.map((a) => a.city.zh)).toEqual(
      expect.arrayContaining(["台北市", "基隆市"]),
    );
    const g = guessAddress("台中");
    expect(g.city?.zh).toBe("台中市");
    expect(g.areas).toHaveLength(0);
  });
});
