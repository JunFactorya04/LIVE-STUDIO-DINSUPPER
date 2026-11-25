// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { BizClient } from "../biz/client";
import { vi as viMessages } from "../i18n/vi";
import type { ShipClient } from "../ship/client";
import type { WarehouseClient } from "../warehouse/client";
import { Team } from "./team";

const origin = { channel: "telegram" as const, to: "42" };

function team(answer: (system: string) => string) {
  const sent: string[] = [];
  const t = new Team({
    ai: { available: true, complete: async ({ system }) => answer(system) },
    ship: { available: false } as unknown as ShipClient,
    warehouse: { available: false } as unknown as WarehouseClient,
    biz: { available: false } as unknown as BizClient,
    catalog: () => [],
    lang: () => "vi",
    texts: () => viMessages.staff.chat,
    send: async (_o, text) => void sent.push(text),
  });
  return { t, sent };
}

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem("live-studio.ai", JSON.stringify({ provider: "claude", models: {} }));
});

describe("Team over chat", () => {
  it("a chat message goes to the lead; each draft comes back with its number", async () => {
    const { t, sent } = team((s) =>
      s.includes("team lead")
        ? '[{"role":"kho","title":"Sắp hết","input":"liệt kê"}]'
        : "Áo A12 còn 1",
    );
    await t.handleChat(origin, "xem hàng sắp hết");
    await vi.waitFor(() => expect(sent).toHaveLength(2));
    expect(sent[0]).toContain("1 việc");
    expect(sent[1]).toContain("#1 Kho: Sắp hết");
    expect(sent[1]).toContain("Áo A12 còn 1");
    expect(sent[1]).toContain("/duyet 1");

    await t.handleChat(origin, "/viec");
    expect(sent[2]).toContain("#1 Kho: Sắp hết");
    await t.handleChat(origin, "/duyet 1");
    expect(t.getSnapshot().tasks[0].status).toBe("approved");
    await t.handleChat(origin, "/bo 9");
    expect(sent[sent.length - 1]).toContain("#9");
  });

  it("without an AI service it says so instead of failing silently", async () => {
    localStorage.removeItem("live-studio.ai");
    const { t, sent } = team(() => "");
    await t.handleChat(origin, "tổng kết hôm nay");
    expect(sent[0]).toBe(viMessages.staff.chat.noAi);
  });
});
