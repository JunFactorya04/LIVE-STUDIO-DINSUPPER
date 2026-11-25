import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createAiClient, type AiClient } from "../ai/client";
import { loadAiConfig } from "../ai/config";
import { createBizClient, type BizClient } from "../biz/client";
import { Sheet } from "../components/Sheet";
import { toast } from "../components/Toast";
import { useI18n } from "../i18n";
import { useLiveSession } from "../live/useLiveSession";
import type { PageId } from "../navigation";
import { loadPolicy } from "../replies/suggest";
import { createShipClient, type ShipClient } from "../ship/client";
import { planWithLead, runTask, type AiChoice, type StaffData } from "../staff/run";
import {
  CHANNELS,
  QUICK,
  ROLES,
  loadNotes,
  loadTasks,
  saveNotes,
  saveTasks,
  type Channel,
  type Period,
  type RoleId,
  type StaffTask,
} from "../staff/staff";
import { createWarehouseClient, type WarehouseClient } from "../warehouse/client";

// "Nhân viên AI": the team as one picture. The team lead sits in the middle; the four staff sit
// on the ring around it, each with what they are doing and how many drafts wait for the seller.
// Tap a staff member to give them work; or ask the lead at the bottom and it splits the request.
// Everything they make is a draft in "Đang chờ bạn duyệt" until the seller approves or drops it.

const ROLE_ICON: Record<RoleId | "lead", string> = {
  lead: "M5 5h5v5H5zM14 5h5v5h-5zM5 14h5v5H5zM14 14h5v5h-5z",
  cskh: "M4 5h16v11H10l-4 3v-3H4zM8 9h8M8 12h5",
  marketing: "M3 10v4h3l5 4V6l-5 4zM16 9a4 4 0 0 1 0 6M19 6a8 8 0 0 1 0 12",
  kho: "M4 8l8-4 8 4v8l-8 4-8-4zM4 8l8 4 8-4M12 12v8",
  ketoan: "M6 3h12v18l-3-2-3 2-3-2-3 2zM9 8h6M9 12h6M9 16h3",
};

const PERIOD_OF: Partial<Record<string, Period>> = { today: "today", week: "week", month: "month" };

function StaffGlyph({ id, size = 22 }: { id: RoleId | "lead"; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={ROLE_ICON[id]} />
    </svg>
  );
}

let seq = 0;
const newId = () => `${Date.now().toString(36)}-${(++seq).toString(36)}`;

export function StaffPage({
  onNavigate,
  ai,
  ship,
  warehouse,
  biz,
}: {
  onNavigate?: (page: PageId) => void;
  ai?: AiClient;
  ship?: ShipClient;
  warehouse?: WarehouseClient;
  biz?: BizClient;
}) {
  const { t, fmt, locale } = useI18n();
  const st = t.staff;
  const s = useLiveSession();
  const [aiApi] = useState(() => ai ?? createAiClient());
  const [shipApi] = useState(() => ship ?? createShipClient());
  const [whApi] = useState(() => warehouse ?? createWarehouseClient());
  const [bizApi] = useState(() => biz ?? createBizClient());
  const [tasks, setTasks] = useState<StaffTask[]>(loadTasks);
  const [notes, setNotes] = useState(loadNotes);
  const [open, setOpen] = useState<RoleId>();
  const [ask, setAsk] = useState("");
  const [planning, setPlanning] = useState(false);
  const [leadNote, setLeadNote] = useState<{ text: string; error: boolean }>();

  const config = loadAiConfig();
  const choice: AiChoice | undefined = config.provider
    ? { provider: config.provider, model: config.models[config.provider] }
    : undefined;

  // Tasks live in a ref too, so a long run never writes back an old list.
  const tasksRef = useRef(tasks);
  const commit = useCallback((next: StaffTask[]) => {
    tasksRef.current = next;
    setTasks(next);
    saveTasks(next);
  }, []);
  const patch = useCallback(
    (id: string, p: Partial<StaffTask>) =>
      commit(tasksRef.current.map((x) => (x.id === id ? { ...x, ...p } : x))),
    [commit],
  );

  const loadData = useCallback(async (): Promise<StaffData> => {
    const safe = <T,>(p: Promise<T[]>) => p.catch(() => [] as T[]);
    const [orders, customers, units, expenses] = await Promise.all([
      shipApi.available ? safe(shipApi.orders()) : [],
      shipApi.available ? safe(shipApi.customers()) : [],
      whApi.available ? safe(whApi.units("IN_STOCK")) : [],
      bizApi.available ? safe(bizApi.expenses()) : [],
    ]);
    return { catalog: s.catalog, units, orders, customers, expenses, policy: loadPolicy() };
  }, [shipApi, whApi, bizApi, s.catalog]);

  const run = useCallback(
    async (task: StaffTask, data?: StaffData) => {
      if (!choice) return;
      patch(task.id, { status: "working", error: undefined });
      try {
        const draft = await runTask(
          aiApi,
          choice,
          task,
          data ?? (await loadData()),
          locale,
          notes[task.role] ?? "",
        );
        patch(task.id, { status: "review", draft });
      } catch (e) {
        patch(task.id, { status: "failed", error: e instanceof Error ? e.message : String(e) });
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [aiApi, choice?.provider, choice?.model, loadData, locale, notes, patch],
  );

  const give = (p: Omit<StaffTask, "id" | "status" | "draft" | "createdAt">) => {
    const task: StaffTask = {
      ...p,
      id: newId(),
      status: "working",
      draft: "",
      createdAt: new Date().toISOString(),
    };
    commit([task, ...tasksRef.current]);
    void run(task);
  };

  const askLead = async () => {
    const text = ask.trim();
    if (!text || !choice) return;
    setPlanning(true);
    setLeadNote({ text: st.leadPlanning, error: false });
    try {
      const plan = await planWithLead(aiApi, choice, text);
      if (plan.length === 0) {
        setLeadNote({ text: st.leadEmpty, error: true });
        return;
      }
      const made = plan.map<StaffTask>((p) => ({
        ...p,
        id: newId(),
        status: "working",
        draft: "",
        fromLead: true,
        createdAt: new Date().toISOString(),
      }));
      commit([...made, ...tasksRef.current]);
      setAsk("");
      setLeadNote({ text: fmt(st.leadDone, { n: made.length }), error: false });
      const data = await loadData();
      for (const task of made) await run(task, data);
    } catch (e) {
      setLeadNote({ text: aiError(e), error: true });
    } finally {
      setPlanning(false);
    }
  };

  const aiError = (e: unknown) => {
    const code = e instanceof Error ? e.message : String(e);
    return (t.settings.ai.errors as Record<string, string>)[code] ?? code;
  };

  const waiting = tasks.filter(
    (x) => x.status === "review" || x.status === "working" || x.status === "failed",
  );
  const reviewCount = tasks.filter((x) => x.status === "review").length;
  const byRole = useMemo(() => {
    const m = new Map<RoleId, { working: number; review: number }>();
    for (const r of ROLES) m.set(r, { working: 0, review: 0 });
    for (const x of tasks) {
      const c = m.get(x.role)!;
      if (x.status === "working") c.working++;
      if (x.status === "review") c.review++;
    }
    return m;
  }, [tasks]);

  return (
    <div className="page page--no-inspector staff">
      <div className="staff__top">
        <span className={`staff__pending${reviewCount ? " is-on" : ""}`} role="status">
          <i aria-hidden="true" />
          {reviewCount ? fmt(st.pending, { n: reviewCount }) : st.nonePending}
        </span>
      </div>

      {!aiApi.available ? (
        <p className="note">{st.notDesktop}</p>
      ) : !choice ? (
        <p className="note">
          {st.noProvider}{" "}
          {onNavigate && (
            <button type="button" className="btn" onClick={() => onNavigate("settings")}>
              {st.openSettings}
            </button>
          )}
        </p>
      ) : null}

      <section className="staff__team" aria-label={t.pages.staff.title}>
        <div className="staff__ring" aria-hidden="true" />
        <div className={`staff__lead${planning ? " is-busy" : ""}`}>
          <span className="staff__lead-badge">
            <StaffGlyph id="lead" size={28} />
          </span>
          <strong>{st.lead}</strong>
        </div>
        {ROLES.map((r, i) => {
          const c = byRole.get(r)!;
          const state = c.working ? "working" : c.review ? "review" : "idle";
          return (
            <button
              key={r}
              type="button"
              className={`staff__member staff__member--${r} staff__pos-${i}`}
              onClick={() => setOpen(r)}
              aria-label={`${st.roles[r].name}: ${st.status[state]}`}
            >
              <span className={`staff__avatar is-${state}`}>
                <StaffGlyph id={r} />
                {c.review > 0 && <span className="staff__count">{c.review}</span>}
              </span>
              <strong>{st.roles[r].name}</strong>
              <span className="caption">{st.status[state]}</span>
            </button>
          );
        })}
      </section>

      <section className="box staff__queue" aria-label={st.waiting}>
        <h2 className="section-title">{st.waiting}</h2>
        {waiting.length === 0 ? (
          <p className="caption">{st.nonePending}</p>
        ) : (
          <ul className="staff__tasks">
            {waiting.map((x) => (
              <TaskCard
                key={x.id}
                task={x}
                onPatch={patch}
                onRedo={() => void run(x)}
                aiError={aiError}
              />
            ))}
          </ul>
        )}
      </section>

      <form
        className="staff__ask"
        onSubmit={(e) => {
          e.preventDefault();
          void askLead();
        }}
      >
        <span className="staff__ask-icon" aria-hidden="true">
          <StaffGlyph id="lead" size={18} />
        </span>
        <input
          className="input"
          aria-label={st.leadAsk}
          placeholder={st.leadAsk}
          value={ask}
          onChange={(e) => setAsk(e.target.value)}
          disabled={planning}
        />
        <button
          type="submit"
          className="btn btn--primary"
          disabled={!choice || planning || !ask.trim()}
        >
          {st.leadSend}
        </button>
      </form>
      <p
        className={`caption staff__ask-note${leadNote?.error ? " note--error" : ""}`}
        role="status"
      >
        {leadNote?.text ?? st.leadHelp}
      </p>

      {open && (
        <Sheet
          title={st.roles[open].name}
          onClose={() => setOpen(undefined)}
          closeLabel={st.close}
          wide
        >
          <MemberPanel
            role={open}
            tasks={tasks.filter((x) => x.role === open)}
            canRun={Boolean(choice)}
            note={notes[open] ?? ""}
            onNote={(v) => {
              const next = { ...notes, [open]: v };
              setNotes(next);
              saveNotes(next);
            }}
            onGive={give}
            onPatch={patch}
            onRedo={(x) => void run(x)}
            aiError={aiError}
            recent={s.comments.slice(-6).reverse()}
          />
        </Sheet>
      )}
    </div>
  );
}

function MemberPanel({
  role,
  tasks,
  canRun,
  note,
  onNote,
  onGive,
  onPatch,
  onRedo,
  aiError,
  recent,
}: {
  role: RoleId;
  tasks: StaffTask[];
  canRun: boolean;
  note: string;
  onNote: (v: string) => void;
  onGive: (p: Omit<StaffTask, "id" | "status" | "draft" | "createdAt">) => void;
  onPatch: (id: string, p: Partial<StaffTask>) => void;
  onRedo: (task: StaffTask) => void;
  aiError: (e: unknown) => string;
  recent: readonly {
    eventId: string;
    username?: string;
    displayName?: string;
    commentText: string;
  }[];
}) {
  const { t, fmt } = useI18n();
  const st = t.staff;
  const [text, setText] = useState("");
  const [channel, setChannel] = useState<Channel>("live");
  const [customer, setCustomer] = useState("");
  const [noteDraft, setNoteDraft] = useState(note);
  useEffect(() => setNoteDraft(note), [note]);

  const quick = (key: string) =>
    onGive({
      role,
      title: (st.quick as Record<string, string>)[key],
      input: (st.quick as Record<string, string>)[key],
      period: PERIOD_OF[key],
    });

  const submit = () => {
    const input = text.trim();
    if (!input) return;
    if (role === "cskh") {
      onGive({
        role,
        title: input.slice(0, 60),
        input,
        channel,
        customer: customer.trim() || undefined,
      });
    } else {
      onGive({
        role,
        title: input.slice(0, 60),
        input,
        period: role === "ketoan" ? "today" : undefined,
      });
    }
    setText("");
  };

  return (
    <div className="staff__panel">
      <p className="muted">{st.roles[role].job}</p>

      {QUICK[role].length > 0 && (
        <div className="staff__quick">
          {QUICK[role].map((k) => (
            <button
              key={k}
              type="button"
              className="btn"
              disabled={!canRun}
              onClick={() => quick(k)}
            >
              {(st.quick as Record<string, string>)[k]}
            </button>
          ))}
        </div>
      )}

      {role === "cskh" && (
        <>
          <div className="segmented staff__channels" role="group" aria-label={st.channel}>
            {CHANNELS.map((c) => (
              <button
                key={c}
                type="button"
                aria-pressed={channel === c}
                onClick={() => setChannel(c)}
              >
                {st.channels[c]}
              </button>
            ))}
          </div>
          {channel === "live" && recent.length > 0 && (
            <div className="staff__recent" aria-label={st.fromLive}>
              <span className="caption">{st.fromLive}</span>
              {recent.map((c) => (
                <button
                  key={c.eventId}
                  type="button"
                  className="staff__comment"
                  onClick={() => {
                    setText(c.commentText);
                    setCustomer(c.username ?? "");
                  }}
                >
                  <strong>{c.username ?? c.displayName ?? "?"}</strong> {c.commentText}
                </button>
              ))}
            </div>
          )}
          <label className="field">
            <span>{st.customer}</span>
            <input
              className="input"
              value={customer}
              onChange={(e) => setCustomer(e.target.value)}
            />
          </label>
        </>
      )}

      <label className="field">
        <span>{role === "cskh" ? st.message : st.other}</span>
        <textarea
          className="input input--area"
          rows={3}
          placeholder={role === "cskh" ? st.messagePh : st.otherPh}
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
      </label>
      <div className="actions">
        <button
          type="button"
          className="btn btn--primary"
          disabled={!canRun || !text.trim()}
          onClick={submit}
        >
          {st.assign}
        </button>
      </div>

      <details className="staff__notes">
        <summary>{st.notes}</summary>
        <textarea
          className="input input--area"
          rows={2}
          aria-label={st.notes}
          placeholder={st.notesPh}
          value={noteDraft}
          onChange={(e) => setNoteDraft(e.target.value)}
          onBlur={() => noteDraft !== note && onNote(noteDraft)}
        />
      </details>

      <h3 className="subhead">{fmt(st.tasks, { name: st.roles[role].name })}</h3>
      {tasks.length === 0 ? (
        <p className="caption">{st.noTasks}</p>
      ) : (
        <ul className="staff__tasks">
          {tasks.slice(0, 20).map((x) => (
            <TaskCard
              key={x.id}
              task={x}
              onPatch={onPatch}
              onRedo={() => onRedo(x)}
              aiError={aiError}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

function TaskCard({
  task,
  onPatch,
  onRedo,
  aiError,
}: {
  task: StaffTask;
  onPatch: (id: string, p: Partial<StaffTask>) => void;
  onRedo: () => void;
  aiError: (e: unknown) => string;
}) {
  const { t } = useI18n();
  const st = t.staff;
  const copy = async (approve: boolean) => {
    try {
      await navigator.clipboard.writeText(task.draft);
      toast(st.copied);
    } catch {
      // copying is a convenience; the text stays on screen to select by hand
    }
    if (approve) onPatch(task.id, { status: "approved" });
  };
  const error =
    task.error === "INTERRUPTED" ? st.errors.INTERRUPTED : task.error ? aiError(task.error) : "";
  return (
    <li className={`staff__task staff__task--${task.status}`}>
      <div className="staff__task-head">
        <span className={`staff__role-dot staff__role-dot--${task.role}`}>
          <StaffGlyph id={task.role} size={14} />
        </span>
        <strong>{task.title}</strong>
        <span className="caption">
          {st.roles[task.role].name}
          {task.channel ? `, ${st.channels[task.channel]}` : ""}
          {task.period ? `, ${st.periods[task.period]}` : ""}
          {task.fromLead ? `, ${st.byLead}` : ""}
        </span>
        <span className={`chip staff__chip--${task.status}`}>{st.status[task.status]}</span>
      </div>
      {task.status === "working" && <div className="staff__working" aria-hidden="true" />}
      {task.status === "failed" && (
        <p className="note note--error" role="alert">
          {error}
        </p>
      )}
      {(task.status === "review" || task.status === "approved") && (
        <textarea
          className="input input--area staff__draft"
          rows={Math.min(12, Math.max(3, task.draft.split("\n").length + 1))}
          aria-label={task.title}
          value={task.draft}
          readOnly={task.status === "approved"}
          onChange={(e) => onPatch(task.id, { draft: e.target.value })}
        />
      )}
      <div className="actions">
        {task.status === "review" && (
          <button type="button" className="btn btn--primary" onClick={() => void copy(true)}>
            {st.approve}
          </button>
        )}
        {task.status === "approved" && (
          <button type="button" className="btn" onClick={() => void copy(false)}>
            {st.copy}
          </button>
        )}
        {(task.status === "review" || task.status === "failed") && (
          <button type="button" className="btn" onClick={onRedo}>
            {st.redo}
          </button>
        )}
        {(task.status === "review" || task.status === "failed") && (
          <button
            type="button"
            className="btn"
            onClick={() => onPatch(task.id, { status: "discarded" })}
          >
            {st.discard}
          </button>
        )}
      </div>
    </li>
  );
}
