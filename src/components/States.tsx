import { useI18n } from "../i18n";

// Every list/page must render one of these states: loading, empty, error.

export function LoadingState() {
  const { t } = useI18n();
  return (
    <div className="state" role="status" aria-live="polite">
      <span className="spinner" aria-hidden="true" />
      <span>{t.common.loading}</span>
    </div>
  );
}

export function EmptyState({ title, hint }: { title?: string; hint?: string }) {
  const { t } = useI18n();
  return (
    <div className="state">
      <strong>{title ?? t.states.emptyTitle}</strong>
      <span>{hint ?? t.states.emptyHint}</span>
    </div>
  );
}

export function ErrorState({ onRetry }: { onRetry?: () => void }) {
  const { t } = useI18n();
  return (
    <div className="state state--error" role="alert">
      <strong>{t.states.errorTitle}</strong>
      <span className="muted">{t.states.errorHint}</span>
      {onRetry && (
        <button type="button" className="btn" onClick={onRetry}>
          {t.common.retry}
        </button>
      )}
    </div>
  );
}
