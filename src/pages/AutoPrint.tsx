import { useEffect, useRef } from "react";
import { useI18n } from "../i18n";
import { useLiveSession } from "../live/useLiveSession";
import { getPrintService, type PrintService } from "../print/service";
import { isConfigured, loadPrinter } from "../print/settings";
import { tempSlip } from "../print/slip";

/**
 * Prints a temporary slip once for each order draft created after the app opened, when the
 * seller turned this on. Drafts restored from storage are older and never reprinted.
 * Renders nothing; a failure shows in Settings and on the Orders page.
 */
export function AutoPrint({ service }: { service?: PrintService }) {
  const { t } = useI18n();
  const s = useLiveSession();
  const startedAt = useRef(new Date().toISOString());
  const done = useRef(new Set<string>());

  useEffect(() => {
    const settings = loadPrinter();
    if (!settings.autoTemp || !isConfigured(settings)) return;
    const svc = service ?? getPrintService();
    for (const d of s.drafts) {
      if (done.current.has(d.id) || d.createdAt < startedAt.current || d.status === "CANCELLED") {
        continue;
      }
      done.current.add(d.id);
      void svc.print(tempSlip(d, s.comments, t.print.slip));
    }
  }, [s.drafts, s.comments, t, service]);

  return null;
}
