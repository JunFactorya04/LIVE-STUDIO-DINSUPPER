import { describe, expect, it } from "vitest";
import { attrChoices, colorChoices, ownSizes, toggleInList } from "./suggestions";

const item = (over: object) => ({
  sku: "A",
  name: "a",
  colors: [],
  sizes: [],
  aliases: [],
  ...over,
});

describe("product form suggestions", () => {
  it("puts the shop's own colours first, then common ones, once each", () => {
    const list = colorChoices("vi", [item({ colors: ["Xanh mint", "Đen"] })]);
    expect(list.slice(0, 3)).toEqual(["Xanh mint", "Đen", "Trắng"]);
    expect(list.filter((c) => c === "Đen")).toHaveLength(1);
  });

  it("keeps non-standard sizes the shop uses", () => {
    expect(ownSizes([item({ sizes: ["M", "90cm"] })])).toEqual(["90cm"]);
  });

  it("suggests values for known attributes and the shop's own ones", () => {
    const cat = [item({ attrs: { "Chất liệu": "Tơ tằm" } })];
    expect(attrChoices("chất liệu", "vi", cat).slice(0, 2)).toEqual(["Tơ tằm", "Cotton"]);
    expect(attrChoices("Màu viền", "vi", [])).toEqual([]);
  });

  it("toggles one value in a ; list", () => {
    expect(toggleInList("Đen;Trắng", "Xám")).toBe("Đen;Trắng;Xám");
    expect(toggleInList("Đen;Trắng", "đen")).toBe("Trắng");
    expect(toggleInList("", "M")).toBe("M");
  });
});
