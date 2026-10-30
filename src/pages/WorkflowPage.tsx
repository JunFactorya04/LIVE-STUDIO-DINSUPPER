import { useCallback, useEffect, useMemo, useState } from "react";
import { EmptyState, ErrorState, LoadingState } from "../components/States";
import { useI18n } from "../i18n";
import { useLiveSession } from "../live/useLiveSession";
import type { PageId } from "../navigation";
import { getPrintService } from "../print/service";
import { isConfigured, loadPrinter } from "../print/settings";
import { printTempSlip } from "../print/tempPrint";
import {
  createShipClient,
  type FlowRecord,
  type ShipClient,
  type ShipCustomer,
  type ShipOrder,
} from "../ship/client";
import { buildFlow, STEPS, type BuyerFlow, type StepId } from "../ship/flow";
import { setShipPrefill } from "../ship/prefill";
import { avatarTone } from "./ConsolePage";

type Note = { text: string; error: boolean } | undefined;

// The routine for each buyer, A to Z: confirmed order, temporary slip, message asking for their
// details, details received, shipping order. The page shows where each buyer stands and gives
// one button for the next step. The app never sends a message: copying is the seller's own act.
export function WorkflowPage({
  client,
  onNavigate,
}: {
  client?: ShipClient;
  onNavigate: (page: PageId) => void;
}) {
  const { t, fmt } = useI18n();
  const w = t.flow;
  const s = useLiveSession();
  const [api] = useState(() => client ?? createShipClient());
  const [data, setData] = useState<{
    orders: ShipOrder[];
    customers: ShipCustomer[];
    flow: FlowRecord[];
  }>();
  const [failed, setFailed] = useState(false);
  const [note, setNote] = useState<Note>();
  const printer = getPrintService();
  const printerReady = printer.available && isConfigured(loadPrinter());

  const load = useCallback(async () => {
    if (!api.available) return;
    setFailed(false);
    try {
      const [orders, customers, flow] = await Promise.all([
        api.orders(),
        api.customers(),
        api.flow(),
      ]);
      setData({ orders, customers, flow });
    } catch {
      setFailed(true);
    }
  }, [api]);

  useEffect(() => {
    void load();
  }, [load]);

  const buyers = useMemo(
    () => (data ? buildFlow({ drafts: s.drafts, printerReady, ...data }) : []),
    [data, s.drafts, printerReady],
  );

  const act = async (b: BuyerFlow, step: StepId) => {
    setNote(undefined);
    if (step === "slip") {
      const draft = s.drafts.find((d) => d.id === b.draftId);
      if (!draft) return setNote({ text: w.noDraft, error: true });
      const ok = await printTempSlip(draft, s.comments, t.print.slip);
      if (ok) await load();
      return;
    }
    if (step === "ask") {
      try {
        await navigator.clipboard.writeText(fmt(t.ship.askMessage, { id: `@${b.tiktokId}` }));
        await api.markFlow(b.tiktokId, "ASK_COPIED");
        setNote({ text: t.ship.customers.copied, error: false });
        await load();
      } catch {
        setNote({ text: t.ship.customers.copyFailed, error: true });
      }
      return;
    }
    // info / ship: the shipping form, with this buyer filled in.
    setShipPrefill(b.tiktokId);
    onNavigate("ship");
  };

  return (
    <div className="page page--no-inspector flow">
      <section className="box">
        <p className="banner banner--info" role="note">
          {w.notice}
        </p>
        {!api.available ? (
          <EmptyState title={t.ship.errors.desktopOnly} hint="" />
        ) : failed ? (
          <ErrorState onRetry={() => void load()} />
        ) : !data ? (
          <LoadingState />
        ) : buyers.length === 0 ? (
          <EmptyState title={w.emptyTitle} hint={w.emptyHint} />
        ) : (
          <>
            {note && (
              <p
                className={`banner ${note.error ? "banner--error" : "banner--info"}`}
                role="status"
              >
                {note.text}
              </p>
            )}
            <ul className="flow__list" aria-label={t.pages.flow.title}>
              {buyers.map((b) => (
                <li key={b.tiktokId} className="flow__card">
                  <div className="flow__head">
                    <span className={`avatar tone-${avatarTone(b.tiktokId)}`} aria-hidden="true">
                      {b.tiktokId.slice(0, 1).toUpperCase()}
                    </span>
                    <div className="flow__who">
                      <strong>@{b.tiktokId}</strong>
                      <span className="muted">{b.name || w.noName}</span>
                    </div>
                    {b.next === undefined ? (
                      <span
                        className={`chip ${b.ship === "exported" ? "tone-green" : "tone-blue"}`}
                      >
                        {b.ship === "exported" ? w.exported : w.ready}
                      </span>
                    ) : null}
                  </div>
                  <ol className="flow__steps">
                    {STEPS.map((step) => (
                      <li
                        key={step}
                        className={`flow__step${b.steps[step] ? " is-done" : ""}${
                          b.next === step ? " is-next" : ""
                        }`}
                        aria-current={b.next === step ? "step" : undefined}
                      >
                        <span className="flow__dot" aria-hidden="true">
                          {b.steps[step] ? "✓" : ""}
                        </span>
                        <span>{w.steps[step]}</span>
                      </li>
                    ))}
                  </ol>
                  {b.next && b.next !== "order" && (
                    <div className="actions">
                      <button
                        type="button"
                        className="btn btn--primary"
                        onClick={() => void act(b, b.next as StepId)}
                      >
                        {w.actions[b.next]}
                      </button>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          </>
        )}
      </section>
    </div>
  );
}
