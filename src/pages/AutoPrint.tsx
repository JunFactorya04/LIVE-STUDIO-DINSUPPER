import { useEffect, useRef } from "react";
import { useI18n } from "../i18n";
import { useLiveSession, useLiveStore } from "../live/useLiveSession";
import { getPrintService, type PrintService } from "../print/service";
import { isConfigured, loadPrinter } from "../print/settings";
import { printTempSlip } from "../print/tempPrint";
import { draftSeq } from "../print/sticker";
import { notifySystem } from "../components/notify";
import { toast } from "../components/Toast";

/**
 * Prints a temporary slip once for each order draft created after the app opened, when the
 * seller turned this on. Drafts restored from storage are older and never reprinted.
 * Renders nothing; a failure shows in Settings and on the Orders page.
 */
export function AutoPrint({ service }: { service?: PrintService }) {
  const { t, fmt } = useI18n();
  const s = useLiveSession();
  const store = useLiveStore();
  const startedAt = useRef(new Date().toISOString());
  const done = useRef(new Set<string>());
  const told = useRef(new Set<string>());

  // A new order while the seller is in another window (OBS, TikTok): the system notification
  // says so. Nothing is shown while the app is in front — the order list already is.
  useEffect(() => {
    for (const d of s.drafts) {
      if (told.current.has(d.id)) continue;
      told.current.add(d.id);
      if (d.createdAt < startedAt.current || d.status === "CANCELLED") continue;
      void notifySystem(
        t.notify.newOrderTitle,
        fmt(t.notify.newOrder, {
          n: draftSeq(s.drafts, d.id),
          user: d.username ? `@${d.username.replace(/^@/, "")}` : "—",
        }),
      );
    }
  }, [s.drafts, t, fmt]);

  useEffect(() => {
    const settings = loadPrinter();
    if (!isConfigured(settings)) return;
    const svc = service ?? getPrintService();
    for (const d of s.drafts) {
      if (done.current.has(d.id) || d.createdAt < startedAt.current || d.status === "CANCELLED") {
        continue;
      }
      // Every new order when auto-print is on; an order made on a phone always — the phone
      // does not print it itself, only this computer does.
      if (!settings.autoTemp && !store.isFromPhone(d.id)) continue;
      done.current.add(d.id);
      const n = draftSeq(s.drafts, d.id);
      void printTempSlip(d, s.comments, t.print.slip, { service: svc, drafts: s.drafts }).then(
        (ok) => {
          if (ok) return;
          const body = fmt(t.notify.printFail, { n });
          toast(`${t.notify.printFailTitle}. ${body}`, { tone: "error" });
          void notifySystem(t.notify.printFailTitle, body);
        },
      );
    }
  }, [s.drafts, s.comments, t, fmt, service, store]);

  return null;
}
