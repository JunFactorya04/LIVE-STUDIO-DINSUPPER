import { vi } from "../i18n/vi";

// Every list/page must render one of these states: loading, empty, error.

export function LoadingState() {
  return (
    <div className="state" role="status" aria-live="polite">
      <span className="spinner" aria-hidden="true" />
      <span>{vi.common.loading}</span>
    </div>
  );
}

export function EmptyState({ title = vi.states.emptyTitle, hint = vi.states.emptyHint }: { title?: string; hint?: string }) {
  return (
    <div className="state">
      <strong>{title}</strong>
      <span>{hint}</span>
    </div>
  );
}

export function ErrorState({ onRetry }: { onRetry?: () => void }) {
  return (
    <div className="state state--error" role="alert">
      <strong>{vi.states.errorTitle}</strong>
      <span className="muted">{vi.states.errorHint}</span>
      {onRetry && (
        <button type="button" className="btn" onClick={onRetry}>
          {vi.common.retry}
        </button>
      )}
    </div>
  );
}
