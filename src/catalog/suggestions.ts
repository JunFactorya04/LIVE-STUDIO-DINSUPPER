import type { Locale } from "../i18n";
import type { CatalogItem } from "../orders/types";

// Ready-made choices for the product form's drop-downs: common colours, sizes and attribute
// values, in the seller's language, plus whatever this shop's own products already use (those
// first, so the shop's own words win). Nothing is required: the seller can still type anything.

const COLORS: Record<Locale, readonly string[]> = {
  vi: [
    "Đen",
    "Trắng",
    "Xám",
    "Be",
    "Kem",
    "Nâu",
    "Đỏ",
    "Đỏ đô",
    "Hồng",
    "Cam",
    "Vàng",
    "Xanh lá",
    "Xanh rêu",
    "Xanh dương",
    "Xanh navy",
    "Tím",
    "Họa tiết",
  ],
  "zh-TW": [
    "黑色",
    "白色",
    "灰色",
    "米色",
    "杏色",
    "咖啡色",
    "紅色",
    "酒紅",
    "粉色",
    "橘色",
    "黃色",
    "綠色",
    "軍綠",
    "藍色",
    "深藍",
    "紫色",
    "花色",
  ],
};

export const SIZE_GROUPS: readonly {
  id: "letter" | "free" | "number";
  values: readonly string[];
}[] = [
  { id: "letter", values: ["XS", "S", "M", "L", "XL", "2XL", "3XL", "4XL"] },
  { id: "free", values: ["Free size"] },
  { id: "number", values: ["26", "27", "28", "29", "30", "31", "32", "34", "36", "38", "40"] },
];

/** Common values for well-known attribute names (both languages accepted as the key). */
const ATTR_VALUES: readonly {
  keys: readonly string[];
  values: Record<Locale, readonly string[]>;
}[] = [
  {
    keys: ["chất liệu", "材質"],
    values: {
      vi: ["Cotton", "Thun", "Lụa", "Jean", "Kaki", "Len", "Nỉ", "Linen", "Voan", "Da"],
      "zh-TW": ["棉", "彈性布", "絲", "牛仔布", "卡其布", "毛料", "刷毛", "亞麻", "雪紡", "皮革"],
    },
  },
  {
    keys: ["xuất xứ", "產地"],
    values: {
      vi: ["Việt Nam", "Đài Loan", "Trung Quốc", "Hàn Quốc", "Nhật Bản", "Thái Lan"],
      "zh-TW": ["越南", "台灣", "中國", "韓國", "日本", "泰國"],
    },
  },
  {
    keys: ["dung tích", "容量"],
    values: {
      vi: ["10ml", "30ml", "50ml", "100ml", "200ml", "500ml", "1L"],
      "zh-TW": ["10ml", "30ml", "50ml", "100ml", "200ml", "500ml", "1L"],
    },
  },
  {
    keys: ["trọng lượng", "重量"],
    values: {
      vi: ["100g", "200g", "250g", "500g", "1kg", "2kg"],
      "zh-TW": ["100g", "200g", "250g", "500g", "1kg", "2kg"],
    },
  },
  {
    keys: ["hạn dùng", "保存期限"],
    values: {
      vi: ["6 tháng", "12 tháng", "18 tháng", "24 tháng", "36 tháng"],
      "zh-TW": ["6個月", "12個月", "18個月", "24個月", "36個月"],
    },
  },
];

const uniq = (list: readonly string[]) => {
  const seen = new Set<string>();
  return list.filter((v) => {
    const k = v.trim().toLowerCase();
    if (!k || seen.has(k)) return false;
    seen.add(k);
    return true;
  });
};

export function colorChoices(locale: Locale, catalog: readonly CatalogItem[]): string[] {
  return uniq([...catalog.flatMap((c) => c.colors), ...COLORS[locale]]);
}

/** Sizes this shop already uses that are not in the standard groups. */
export function ownSizes(catalog: readonly CatalogItem[]): string[] {
  const standard = new Set(SIZE_GROUPS.flatMap((g) => g.values.map((v) => v.toLowerCase())));
  return uniq(catalog.flatMap((c) => c.sizes)).filter((s) => !standard.has(s.toLowerCase()));
}

export function attrChoices(
  key: string,
  locale: Locale,
  catalog: readonly CatalogItem[],
): string[] {
  const k = key.trim().toLowerCase();
  if (!k) return [];
  const used = catalog.flatMap((c) =>
    Object.entries(c.attrs ?? {})
      .filter(([name, v]) => name.trim().toLowerCase() === k && v)
      .map(([, v]) => v),
  );
  const known = ATTR_VALUES.find((a) => a.keys.includes(k))?.values[locale] ?? [];
  return uniq([...used, ...known]);
}

/** Add or remove one value in a ";"-separated list, keeping the order it was picked in. */
export function toggleInList(list: string, value: string): string {
  const parts = list
    .split(/[;；/、]/)
    .map((s) => s.trim())
    .filter(Boolean);
  const has = parts.some((p) => p.toLowerCase() === value.toLowerCase());
  return (
    has ? parts.filter((p) => p.toLowerCase() !== value.toLowerCase()) : [...parts, value]
  ).join(";");
}
