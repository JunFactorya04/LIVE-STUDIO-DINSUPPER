import type { Expense } from "../biz/client";
import type { AiClient } from "../ai/client";
import type { AiProviderId } from "../ai/config";
import type { CatalogItem } from "../orders/types";
import type { ShipCustomer, ShipOrder } from "../ship/client";
import type { Unit } from "../warehouse/client";
import {
  LEAD_SYSTEM,
  booksFacts,
  books,
  customerFacts,
  parsePlan,
  salesFacts,
  stockFacts,
  systemFor,
  type Lang,
  type PlannedTask,
  type StaffTask,
} from "./staff";

/** What the staff can read: the shop's own data, loaded once per run. */
export interface StaffData {
  catalog: readonly CatalogItem[];
  units: readonly Unit[];
  orders: readonly ShipOrder[];
  customers: readonly ShipCustomer[];
  expenses: readonly Expense[];
  policy: string;
}

const MAX_PROMPT = 19_000;
const DAYS = { today: 1, week: 7, month: 30 } as const;

export function promptFor(task: StaffTask, d: StaffData, now = new Date()): string {
  const policy = `Shop policy:\n${d.policy.trim().slice(0, 2_000) || "(none)"}`;
  const ask = `Task (JSON string): ${JSON.stringify(task.input.slice(0, 1_500))}`;
  let parts: string[];
  switch (task.role) {
    case "cskh":
      parts = [
        `Products and stock:\n${stockFacts(d.units, d.catalog)}`,
        policy,
        customerFacts(task.customer ?? "", d.orders, d.customers),
        `Channel: ${task.channel ?? "live"}`,
        `Customer message (JSON string): ${JSON.stringify(task.input.slice(0, 1_500))}`,
      ];
      break;
    case "marketing":
      parts = [
        `Products and stock:\n${stockFacts(d.units, d.catalog)}`,
        salesFacts(d.orders, 30, now),
        policy,
        ask,
      ];
      break;
    case "kho":
      parts = [
        `Stock by colour/size:\n${stockFacts(d.units, d.catalog)}`,
        salesFacts(d.orders, 7, now),
        salesFacts(d.orders, 30, now),
        ask,
      ];
      break;
    case "ketoan": {
      const period = task.period ?? "today";
      parts = [
        booksFacts(books(d.orders, d.expenses, period, now), period),
        salesFacts(d.orders, DAYS[period], now),
        ask,
      ];
      break;
    }
  }
  return parts.join("\n\n").slice(0, MAX_PROMPT);
}

export interface AiChoice {
  provider: AiProviderId;
  model?: string;
}

export async function runTask(
  ai: AiClient,
  choice: AiChoice,
  task: StaffTask,
  data: StaffData,
  lang: Lang,
  note: string,
): Promise<string> {
  const text = await ai.complete({
    ...choice,
    system: systemFor(task.role, lang, note, task.channel),
    prompt: promptFor(task, data),
    maxTokens: task.role === "cskh" ? 400 : 1_024,
  });
  return text
    .trim()
    .replace(/^```\w*\n?|\n?```$/g, "")
    .trim();
}

/** The team lead splits the owner's request into tasks for the staff. */
export async function planWithLead(
  ai: AiClient,
  choice: AiChoice,
  request: string,
): Promise<PlannedTask[]> {
  const answer = await ai.complete({
    ...choice,
    system: LEAD_SYSTEM,
    prompt: `Owner's request (JSON string): ${JSON.stringify(request.slice(0, 2_000))}`,
    maxTokens: 800,
  });
  return parsePlan(answer);
}

export type { Lang };
