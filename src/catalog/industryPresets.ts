import type { Locale } from "../i18n";

// Quick-start field names for the catalog's free-form "attrs" (orders/types.ts CatalogItem.attrs):
// one tap adds a few empty attribute rows the seller only has to fill in, instead of typing a
// field name from scratch every time. Clothing's own fields (colors/sizes) already have their
// own inputs, so this only needs to cover what clothing does NOT already ask for, plus the two
// other shop kinds the seller named: tạp hóa (grocery) and mỹ phẩm (cosmetics). A seller selling
// something else entirely just types whatever field names fit — nothing here is required.

export const INDUSTRIES = ["clothing", "grocery", "cosmetics"] as const;
export type Industry = (typeof INDUSTRIES)[number];

const PRESETS: Record<Locale, Record<Industry, readonly string[]>> = {
  vi: {
    clothing: ["Chất liệu", "Xuất xứ"],
    grocery: ["Hạn dùng", "Nhà sản xuất", "Trọng lượng", "Xuất xứ"],
    cosmetics: ["Hạn dùng", "Dung tích", "Thương hiệu", "Thành phần chính"],
  },
  "zh-TW": {
    clothing: ["材質", "產地"],
    grocery: ["保存期限", "製造商", "重量", "產地"],
    cosmetics: ["保存期限", "容量", "品牌", "主要成分"],
  },
};

/** Field names to quick-add for one industry, in the seller's current UI language. */
export function presetFields(locale: Locale, industry: Industry): readonly string[] {
  return PRESETS[locale][industry];
}
