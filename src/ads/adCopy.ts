import { createAiClient, type AiClient } from "../ai/client";
import { loadAiConfig } from "../ai/config";
import type { AdPlatformId } from "./registry";

// AI-drafted ad copy (headline + description), seller's own key — same BYOK pattern as the reply
// suggestions on the Live tabs. The seller always reviews and edits before using anything in a
// real campaign; this never talks to an ad platform, it only drafts text.
//
// The per-platform tone notes below are general advertising-copy practice (benefit-first,
// concrete numbers, one clear call to action, platform-appropriate register) — not a verbatim
// copy of any third-party skill or prompt file.

const TONE: Record<AdPlatformId, string> = {
  tiktok:
    "TikTok: giọng điệu tự nhiên, gần gũi như một người thật đang nói, không như quảng cáo truyền thống. Câu ngắn, có thể dùng emoji vừa phải, nhấn vào một lợi ích cụ thể và tạo cảm giác cần hành động ngay.",
  meta: "Facebook/Instagram: mở đầu bằng một câu khơi gợi sự chú ý hoặc một con số/kết quả cụ thể, kể ngắn một câu chuyện hoặc vấn đề quen thuộc với người đọc, rồi mới tới lời mời hành động.",
  google:
    "Google: người đọc đang tìm kiếm chủ động, nên vào thẳng từ khóa/ý định tìm kiếm, nêu lợi ích chính và một điểm khác biệt rõ ràng, giữ câu ngắn để vừa độ dài tiêu đề quảng cáo tìm kiếm.",
};

export interface AdCopyRequest {
  platform: AdPlatformId;
  /** What's being advertised: product name, offer, audience — in the seller's own words. */
  brief: string;
}

export interface AdCopyResult {
  headline: string;
  description: string;
}

const SYSTEM =
  "Bạn là trợ lý viết nội dung quảng cáo cho người bán hàng online tại Đài Loan. " +
  "Luôn trả lời đúng định dạng hai dòng: dòng đầu bắt đầu bằng 'Tiêu đề: ', dòng sau bắt đầu bằng 'Mô tả: '. " +
  "Không thêm giải thích, không thêm dòng nào khác. Tiêu đề ngắn (dưới 40 ký tự), mô tả ngắn (dưới 120 ký tự). " +
  "Không bịa số liệu, cam kết hay đánh giá khách hàng không có trong yêu cầu.";

function parse(answer: string): AdCopyResult {
  const headline = /Tiêu đề:\s*(.+)/i.exec(answer)?.[1]?.trim() ?? "";
  const description = /Mô tả:\s*(.+)/i.exec(answer)?.[1]?.trim() ?? "";
  return { headline, description };
}

export async function suggestAdCopy(
  req: AdCopyRequest,
  deps: { ai?: AiClient } = {},
): Promise<AdCopyResult> {
  const config = loadAiConfig();
  if (!config.provider) throw new Error("NO_PROVIDER");
  const ai = deps.ai ?? createAiClient();
  const prompt = `${TONE[req.platform]}\n\nNội dung cần quảng cáo: ${req.brief}`;
  const answer = await ai.complete({
    provider: config.provider,
    model: config.models[config.provider],
    system: SYSTEM,
    prompt,
    maxTokens: 200,
  });
  const result = parse(answer);
  if (!result.headline && !result.description) throw new Error("BAD_RESPONSE");
  return result;
}
