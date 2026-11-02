import type { Locale } from "../i18n";
import type { CommentIntent } from "./types";

// A free, instant alternative to AI classification (../ai/classifier.ts): matches a comment
// against a small set of keyword "scenarios" per language, entirely offline, with no AI call
// and no cost. The seller can use either one — both write the exact same CommentIntent /
// intentConfidence fields on the comment, so the rest of the app (filters, the "needs review"
// list, order drafting) can't tell which one ran. AI stays reserved for what rules truly can't
// do well: drafting a reply (see ../replies/suggest.ts) — rules never write a reply.

export interface RuleClassification {
  intent: CommentIntent;
  confidence: number;
}

/** Confidence for an unmatched comment: low enough to land in the "needs review" filter
 *  (threshold 0.6 in ConsolePage), since a plain keyword miss is not a confident "OTHER". */
const FALLBACK_CONFIDENCE = 0.4;
/** Confidence for a keyword hit. Rules are exact-match, not probabilistic, so a hit is either
 *  "this scenario" or nothing — there is no partial score to report. */
const MATCH_CONFIDENCE = 1;

type Scenario = Exclude<CommentIntent, "OTHER">;

// Checked in this order: a link/ad marker outranks any other word in the same comment, and a
// clear "I'll take it" phrase outranks a mere product question (e.g. "đen size M lấy 2 cái"
// matches both PRODUCT_QUESTION and PURCHASE keywords — the seller cares about the order intent).
const PRIORITY: readonly Scenario[] = ["SPAM", "PURCHASE", "PRODUCT_QUESTION", "QUESTION"];

// Vietnamese keywords are stored pre-stripped of diacritics (see normalizeVi) because live
// comments are very often typed without them ("con mau den khong" for "còn màu đen không").
const RULES: Record<Locale, Record<Scenario, readonly string[]>> = {
  vi: {
    SPAM: ["http://", "https://", "www.", "inbox e gia re", "zalo:", "tele:", "lien he zalo"],
    PURCHASE: [
      "lay ",
      "lay nha",
      "chot ",
      "dat ",
      "order",
      "cho em 1",
      "cho em lay",
      "cho minh lay",
      "ship cho",
      "mua ",
    ],
    PRODUCT_QUESTION: [
      "con mau",
      "con size",
      "con hang",
      "con k",
      "con ko",
      "het hang",
      "chat lieu",
      "gia bao nhieu",
      "bao nhieu tien",
      "size nao",
      "mau gi",
    ],
    QUESTION: ["phi ship", "van chuyen", "thanh toan", "bao lau", "doi tra", "cod", "cach dat"],
  },
  "zh-TW": {
    SPAM: ["http://", "https://", "www.", "加line", "加賴", "line id", "歡迎私訊代購"],
    PURCHASE: ["買", "下單", "我要", "幫我留", "拍下", "訂一個", "我下"],
    PRODUCT_QUESTION: ["顏色", "尺寸", "還有", "庫存", "材質", "多少錢", "價格", "有現貨"],
    QUESTION: ["運費", "付款", "多久到", "退換貨", "貨到付款", "怎麼下單"],
  },
};

const normalizeVi = (s: string): string =>
  s.toLowerCase().replace(/đ/g, "d").normalize("NFD").replace(/[̀-ͯ]/g, "");

/** Keyword labels for one scenario, in the seller's current UI language — used by the catalog
 *  of presets shown to the seller (and by classifyByRules itself). */
export function scenarioKeywords(locale: Locale, scenario: Scenario): readonly string[] {
  return RULES[locale]?.[scenario] ?? RULES.vi[scenario];
}

/** Label one comment by keyword match. Never throws, never calls out — always returns
 *  something, falling back to a low-confidence OTHER when nothing matches. */
export function classifyByRules(text: string, locale: Locale): RuleClassification {
  const hay = locale === "vi" ? normalizeVi(text) : text.toLowerCase();
  for (const scenario of PRIORITY) {
    const hit = scenarioKeywords(locale, scenario).some((kw) => hay.includes(kw));
    if (hit) return { intent: scenario, confidence: MATCH_CONFIDENCE };
  }
  return { intent: "OTHER", confidence: FALLBACK_CONFIDENCE };
}
