import { describe, expect, it } from "vitest";
import { matchScore, parseStoreQuery } from "./storeQuery";

describe("parseStoreQuery", () => {
  it("passes numbers and Chinese through", () => {
    expect(parseStoreQuery("131386").keys).toEqual(["131386"]);
    expect(parseStoreQuery("信義路").keys).toEqual(["信義路"]);
  });
  it("turns pinyin and English place names into Chinese", () => {
    const r = parseStoreQuery("Xinyi District, Taipei");
    expect(r.keys).toContain("信義");
    expect(r.keys).toContain("台北");
    expect(r.unknown).toEqual([]);
  });
  it("ignores tone marks, case and spacing, and reads two-word places", () => {
    expect(parseStoreQuery("Zhōngshān").keys).toEqual(["中山"]);
    expect(parseStoreQuery("night market").keys).toEqual(["夜市"]);
  });
  it("joins a road suffix to its name", () => {
    expect(parseStoreQuery("zhongshan rd").keys[0]).toBe("中山路");
  });
  it("reports words it does not know", () => {
    const r = parseStoreQuery("xinyi blahblah");
    expect(r.keys).toEqual(["信義"]);
    expect(r.unknown).toEqual(["blahblah"]);
  });
  it("scores results by how many pieces match", () => {
    expect(matchScore(["信義", "台北"], "台北市信義區松仁路")).toBe(2);
    expect(matchScore(["信義", "台北"], "高雄市")).toBe(0);
  });
});
