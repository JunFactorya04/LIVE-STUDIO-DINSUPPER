import { useI18n } from "../i18n";
import type { LiveProviderStatus } from "../live/types";

// Colour is never the only signal: the label is always shown, plus a dot.
const TONE: Record<LiveProviderStatus, string> = {
  DISCONNECTED: "tone-gray",
  CONNECTING: "tone-blue",
  CONNECTED: "tone-green",
  UNAVAILABLE: "tone-orange",
  DEMO: "tone-orange",
  MANUAL: "tone-blue",
  ERROR: "tone-red",
};

export function StatusChip({ status }: { status: LiveProviderStatus }) {
  const { t } = useI18n();
  return (
    <span className={`chip ${TONE[status]}`} data-status={status}>
      <span className="chip__dot" aria-hidden="true" />
      {t.status[status]}
    </span>
  );
}
