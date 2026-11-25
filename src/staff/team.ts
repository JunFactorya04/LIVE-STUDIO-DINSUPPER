import type { AiClient } from "../ai/client";
import { loadAiConfig } from "../ai/config";
import type { BizClient } from "../biz/client";
import type { CatalogItem } from "../orders/types";
import { loadPolicy } from "../replies/suggest";
import type { ShipClient } from "../ship/client";
import type { WarehouseClient } from "../warehouse/client";
import { planWithLead, runTask, type AiChoice, type StaffData } from "./run";
import {
  loadNotes,
  loadTasks,
  saveNotes,
  saveTasks,
  type Lang,
  type RoleId,
  type StaffTask,
} from "./staff";

// The AI team as one shared service: the Nhân viên AI page and the owner's Telegram/WhatsApp chat
// both give it work, and both see the same tasks. A task that came from a chat sends its draft
// back to that chat when it is ready; the owner approves with /duyet <số> or in the app.

export interface Origin {
  channel: "telegram" | "whatsapp";
  to: string;
}

export interface ChatTexts {
  help: string;
  planned: string;
  empty: string;
  noAi: string;
  report: string;
  failed: string;
  approved: string;
  discarded: string;
  notFound: string;
  list: string;
  none: string;
  roles: Record<RoleId, string>;
}

export interface TeamDeps {
  ai: AiClient;
  ship: ShipClient;
  warehouse: WarehouseClient;
  biz: BizClient;
  catalog: () => readonly CatalogItem[];
  lang: () => Lang;
  /** Sends a message to the owner's chat (Telegram or WhatsApp). */
  send?: (origin: Origin, text: string) => Promise<void>;
  texts?: () => ChatTexts;
}

export interface TeamSnapshot {
  tasks: readonly StaffTask[];
  notes: Partial<Record<RoleId, string>>;
  planning: boolean;
}

export type NewTask = Omit<StaffTask, "id" | "status" | "draft" | "createdAt" | "no">;

let seq = 0;
const newId = () => `${Date.now().toString(36)}-${(++seq).toString(36)}`;

export class Team {
  private snap: TeamSnapshot;
  private listeners = new Set<() => void>();
  private origins = new Map<string, Origin>();

  constructor(private deps: TeamDeps) {
    this.snap = { tasks: loadTasks(), notes: loadNotes(), planning: false };
  }

  /** The bridge fills in chat sending and texts once the app knows them. */
  configure(patch: Partial<TeamDeps>) {
    this.deps = { ...this.deps, ...patch };
  }

  subscribe = (l: () => void) => {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  };
  getSnapshot = () => this.snap;

  private set(patch: Partial<TeamSnapshot>) {
    this.snap = { ...this.snap, ...patch };
    if (patch.tasks) saveTasks(this.snap.tasks);
    if (patch.notes) saveNotes(this.snap.notes);
    this.listeners.forEach((l) => l());
  }

  choice(): AiChoice | undefined {
    const c = loadAiConfig();
    return c.provider ? { provider: c.provider, model: c.models[c.provider] } : undefined;
  }

  setNote(role: RoleId, text: string) {
    this.set({ notes: { ...this.snap.notes, [role]: text } });
  }

  patch(id: string, p: Partial<StaffTask>) {
    this.set({ tasks: this.snap.tasks.map((x) => (x.id === id ? { ...x, ...p } : x)) });
  }

  private nextNo(): number {
    return this.snap.tasks.reduce((m, x) => Math.max(m, x.no ?? 0), 0) + 1;
  }

  private create(p: NewTask, origin?: Origin): StaffTask {
    const task: StaffTask = {
      ...p,
      id: newId(),
      no: this.nextNo(),
      status: "working",
      draft: "",
      createdAt: new Date().toISOString(),
    };
    if (origin) this.origins.set(task.id, origin);
    this.set({ tasks: [task, ...this.snap.tasks] });
    return task;
  }

  async loadData(): Promise<StaffData> {
    const { ship, warehouse, biz } = this.deps;
    const safe = <T>(p: Promise<T[]>) => p.catch(() => [] as T[]);
    const [orders, customers, units, expenses] = await Promise.all([
      ship.available ? safe(ship.orders()) : [],
      ship.available ? safe(ship.customers()) : [],
      warehouse.available ? safe(warehouse.units("IN_STOCK")) : [],
      biz.available ? safe(biz.expenses()) : [],
    ]);
    return {
      catalog: this.deps.catalog(),
      units,
      orders,
      customers,
      expenses,
      policy: loadPolicy(),
    };
  }

  async run(task: StaffTask, data?: StaffData) {
    const choice = this.choice();
    if (!choice) return;
    this.patch(task.id, { status: "working", error: undefined });
    try {
      const draft = await runTask(
        this.deps.ai,
        choice,
        task,
        data ?? (await this.loadData()),
        this.deps.lang(),
        this.snap.notes[task.role] ?? "",
      );
      this.patch(task.id, { status: "review", draft });
    } catch (e) {
      this.patch(task.id, { status: "failed", error: e instanceof Error ? e.message : String(e) });
    }
    await this.report(task.id);
  }

  give(p: NewTask, origin?: Origin) {
    void this.run(this.create(p, origin));
  }

  /** The lead splits a request into tasks and runs them one after another. Returns how many. */
  async askLead(request: string, origin?: Origin): Promise<number> {
    const choice = this.choice();
    if (!choice) throw new Error("NO_PROVIDER");
    this.set({ planning: true });
    try {
      const plan = await planWithLead(this.deps.ai, choice, request);
      if (plan.length === 0) return 0;
      const made = plan.reverse().map((p) => this.create({ ...p, fromLead: true }, origin));
      made.reverse();
      void (async () => {
        const data = await this.loadData();
        for (const t of made) await this.run(t, data);
      })();
      return made.length;
    } finally {
      this.set({ planning: false });
    }
  }

  private find(no: number) {
    return this.snap.tasks.find((x) => x.no === no);
  }

  /** A finished task that came from a chat goes back to it. */
  private async report(id: string) {
    const origin = this.origins.get(id);
    const task = this.snap.tasks.find((x) => x.id === id);
    const tx = this.deps.texts?.();
    if (!origin || !task || !this.deps.send || !tx) return;
    this.origins.delete(id);
    const head = `#${task.no} ${tx.roles[task.role]}: ${task.title}`;
    const text =
      task.status === "review"
        ? `${head}\n\n${task.draft}\n\n${tx.report.replace(/\{no\}/g, String(task.no))}`
        : `${head}\n${tx.failed}`;
    await this.deps.send(origin, text).catch(() => undefined);
  }

  /** A message from the owner's chat: a command, or work for the lead. */
  async handleChat(origin: Origin, raw: string): Promise<void> {
    const tx = this.deps.texts?.();
    const send = this.deps.send;
    if (!tx || !send) return;
    const reply = (s: string) => send(origin, s).catch(() => undefined);
    const text = raw.trim();
    const cmd = text.match(/^\/(\S+)\s*(\d+)?/);
    if (cmd) {
      const name = cmd[1].toLowerCase().split("@")[0];
      const no = cmd[2] ? Number(cmd[2]) : NaN;
      const task = Number.isFinite(no) ? this.find(no) : undefined;
      if (name === "start" || name === "help" || name === "huongdan") return void reply(tx.help);
      if (name === "viec" || name === "tasks") {
        const waiting = this.snap.tasks.filter((x) => x.status === "review").slice(0, 20);
        return void reply(
          waiting.length
            ? `${tx.list}\n${waiting.map((x) => `#${x.no} ${tx.roles[x.role]}: ${x.title}`).join("\n")}`
            : tx.none,
        );
      }
      if (["duyet", "ok", "bo", "huy", "xem"].includes(name)) {
        if (!task) return void reply(tx.notFound.replace("{no}", cmd[2] ?? "?"));
        if (name === "xem") return void reply(`#${task.no} ${task.title}\n\n${task.draft}`);
        if (name === "duyet" || name === "ok") {
          this.patch(task.id, { status: "approved" });
          return void reply(tx.approved.replace("{no}", String(task.no)));
        }
        this.patch(task.id, { status: "discarded" });
        return void reply(tx.discarded.replace("{no}", String(task.no)));
      }
      return void reply(tx.help);
    }
    try {
      const n = await this.askLead(text, origin);
      await reply(n ? tx.planned.replace("{n}", String(n)) : tx.empty);
    } catch (e) {
      await reply(e instanceof Error && e.message === "NO_PROVIDER" ? tx.noAi : tx.empty);
    }
  }
}
