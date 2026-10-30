import { isSearchKey, searchShortcut } from "../components/shortcut";
import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { EmptyState } from "../components/States";
import { StatusChip } from "../components/StatusChip";
import { useI18n } from "../i18n";
import type { CommentIntent, LiveCommentEvent } from "../live/types";
import { useLiveSession, useLiveStore } from "../live/useLiveSession";
import { ReplyCard } from "./ReplyCard";

const FILTERS = ["all", "questions", "purchase", "product", "spam", "review"] as const;
type Filter = (typeof FILTERS)[number];
const VISIBLE_LIMIT = 200;

const INTENT_TONE: Record<CommentIntent, string> = {
  QUESTION: "tone-blue",
  PURCHASE: "tone-green",
  PRODUCT_QUESTION: "tone-purple",
  SPAM: "tone-red",
  OTHER: "tone-gray",
};

const SOURCE_TONE: Record<LiveCommentEvent["source"], string> = {
  DEMO: "tone-orange",
  OFFICIAL_API: "tone-blue",
  APPROVED_CONNECTOR: "tone-blue",
  OCR: "tone-gray",
  MANUAL: "tone-gray",
  UNOFFICIAL_CONNECTOR: "tone-orange",
};

function useElapsed(startedAt?: string, endedAt?: string): string | undefined {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!startedAt || endedAt) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [startedAt, endedAt]);
  if (!startedAt) return undefined;
  const end = endedAt ? Date.parse(endedAt) : now;
  const total = Math.max(0, Math.floor((end - Date.parse(startedAt)) / 1000));
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(Math.floor(total / 3600))}:${pad(Math.floor((total % 3600) / 60))}:${pad(total % 60)}`;
}

export function ConsolePage() {
  const { t, fmt, formatTime } = useI18n();
  const store = useLiveStore();
  const s = useLiveSession();
  const [filter, setFilter] = useState<Filter>("all");
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState<string | undefined>();
  const [confirmClear, setConfirmClear] = useState(false);
  const elapsed = useElapsed(s.startedAt, s.endedAt);
  const searchRef = useRef<HTMLInputElement>(null);

  // Cmd/Ctrl+F focuses the feed search (desktop keyboard standard).
  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (isSearchKey(e)) {
        e.preventDefault();
        searchRef.current?.focus();
        searchRef.current?.select();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Comments that sit behind an order draft the seller still has to review.
  const reviewIds = useMemo(
    () =>
      new Set(
        s.drafts
          .filter((d) => d.status === "NEEDS_REVIEW")
          .flatMap((d) => d.evidence.map((e) => e.eventId)),
      ),
    [s.drafts],
  );

  const matching = useMemo(() => {
    const q = query.trim().toLowerCase();
    return s.comments.filter((c) => {
      if (
        q &&
        !c.commentText.toLowerCase().includes(q) &&
        !(c.username ?? "").toLowerCase().includes(q)
      ) {
        return false;
      }
      switch (filter) {
        case "all":
          return true;
        case "questions":
          return c.intent === "QUESTION";
        case "purchase":
          return c.intent === "PURCHASE";
        case "product":
          return c.intent === "PRODUCT_QUESTION";
        case "spam":
          return c.intent === "SPAM";
        case "review":
          return (
            reviewIds.has(c.eventId) ||
            (c.intentConfidence !== undefined && c.intentConfidence < 0.6)
          );
      }
    });
  }, [s.comments, filter, query, reviewIds]);
  const unclassified = s.comments.filter((c) => !c.intent).length;

  // Newest first; only the latest VISIBLE_LIMIT rows are put in the DOM.
  const rows = useMemo(() => matching.slice(-VISIBLE_LIMIT).reverse(), [matching]);
  const selected =
    rows.find((c) => c.eventId === selectedId) ?? s.comments.find((c) => c.eventId === selectedId);

  const noSource =
    s.comments.length === 0 && (s.status === "DISCONNECTED" || s.status === "UNAVAILABLE");
  const running = Boolean(s.startedAt && !s.endedAt);

  const onRowKey = (e: KeyboardEvent<HTMLTableRowElement>, index: number) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      setSelectedId(rows[index].eventId);
    } else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      const next = rows[index + (e.key === "ArrowDown" ? 1 : -1)];
      if (!next) return;
      setSelectedId(next.eventId);
      (
        e.currentTarget.parentElement?.children[index + (e.key === "ArrowDown" ? 1 : -1)] as
          HTMLElement | undefined
      )?.focus();
    }
  };

  return (
    <div className="console">
      <section className="box console__stats" aria-label={t.console.session}>
        <h2 className="section-title">{t.console.session}</h2>
        <StatusChip status={s.status} />
        <dl className="kv">
          <dt>{t.console.runtime}</dt>
          <dd className="num">{elapsed ?? t.console.notStarted}</dd>
          <dt>{t.console.totalComments}</dt>
          <dd className="num">{s.comments.length}</dd>
          <dt>{t.console.drafts}</dt>
          <dd className="num">{s.drafts.filter((d) => d.status === "DRAFT").length}</dd>
          <dt>{t.console.needsReview}</dt>
          <dd className="num">{s.drafts.filter((d) => d.status === "NEEDS_REVIEW").length}</dd>
          {s.duplicates > 0 && (
            <>
              <dt>{t.console.duplicates}</dt>
              <dd className="num">{s.duplicates}</dd>
            </>
          )}
          {s.dropped > 0 && (
            <>
              <dt>{t.console.dropped}</dt>
              <dd className="num">{s.dropped}</dd>
            </>
          )}
        </dl>
        {s.endedAt && <p className="caption">{t.console.ended}</p>}
        <div className="stack">
          {running && (
            <button type="button" className="btn" onClick={() => void store.endSession()}>
              {t.console.endSession}
            </button>
          )}
          {confirmClear ? (
            <div className="actions">
              <p className="caption">{t.console.clearHint}</p>
              <button
                type="button"
                className="btn btn--destructive"
                onClick={() => {
                  store.clearComments();
                  setSelectedId(undefined);
                  setConfirmClear(false);
                }}
              >
                {t.console.clearConfirm}
              </button>
              <button type="button" className="btn" onClick={() => setConfirmClear(false)}>
                {t.common.cancel}
              </button>
            </div>
          ) : (
            <button
              type="button"
              className="btn"
              disabled={s.comments.length === 0}
              onClick={() => setConfirmClear(true)}
            >
              {t.console.clear}
            </button>
          )}
        </div>
      </section>

      <section className="box console__feed" aria-label={t.console.feedLabel}>
        {s.status === "DEMO" && (
          <p className="banner" role="status">
            {t.console.demoBanner}
          </p>
        )}
        {s.restored && s.comments.length > 0 && (
          <p className="banner banner--info" role="status">
            {t.console.restoredBanner}
          </p>
        )}
        {s.persistError && (
          <p className="banner banner--error" role="alert">
            {t.console.persistError}
          </p>
        )}
        {s.providerType === "euler" && (
          <p className="banner" role="status">
            {t.console.unofficialBanner}
          </p>
        )}
        {s.providerType === "euler" && s.statusReason && (
          <p className="banner banner--error" role="alert">
            {t.statusReason[s.statusReason as keyof typeof t.statusReason] ?? t.statusReason.OTHER}
          </p>
        )}
        {s.aiError && (
          <p className="banner banner--error" role="alert">
            {s.aiError === "NO_PROVIDER" ? t.console.aiNoProvider : t.settings.ai.errors[s.aiError]}
          </p>
        )}
        {s.status === "MANUAL" && <PasteBox running={running} />}
        <div className="feed-tools">
          <input
            ref={searchRef}
            className="input"
            type="search"
            placeholder={t.console.searchPlaceholder}
            aria-label={t.console.searchPlaceholder}
            title={`${t.console.searchPlaceholder} (${searchShortcut()})`}
            aria-keyshortcuts="Control+F Meta+F"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <button
            type="button"
            className="btn"
            disabled={s.classifying || unclassified === 0}
            title={t.console.classifyHint}
            onClick={() => void store.classifyPending()}
          >
            {s.classifying ? t.console.classifying : fmt(t.console.classify, { n: unclassified })}
          </button>
          <div className="segmented" role="group" aria-label={t.console.feedLabel}>
            {FILTERS.map((f) => (
              <button
                key={f}
                type="button"
                aria-pressed={filter === f}
                onClick={() => setFilter(f)}
              >
                {t.console.filters[f]}
              </button>
            ))}
          </div>
        </div>

        {noSource ? (
          <EmptyState title={t.console.noSource} hint={t.console.noSourceHint} />
        ) : s.comments.length === 0 ? (
          <EmptyState title={t.console.emptyFeed} hint={t.console.emptyFeedHint} />
        ) : rows.length === 0 ? (
          <EmptyState
            title={t.console.noMatch}
            hint={filter !== "all" && filter !== "review" ? t.console.filterNeedsAi : ""}
          />
        ) : (
          <div className="feed-scroll">
            {/* Explicit ARIA roles: on phones the table is laid out as cards (display: block),
                which would otherwise drop the native table semantics. */}
            <table className="table feed-table" role="grid" aria-label={t.console.feedLabel}>
              <thead>
                <tr role="row">
                  <th role="columnheader" scope="col">
                    {t.console.columns.time}
                  </th>
                  <th role="columnheader" scope="col">
                    {t.console.columns.user}
                  </th>
                  <th role="columnheader" scope="col">
                    {t.console.columns.comment}
                  </th>
                  <th role="columnheader" scope="col">
                    {t.console.columns.source}
                  </th>
                  <th role="columnheader" scope="col">
                    {t.console.columns.ai}
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((c, i) => (
                  <tr
                    key={`${c.source}-${c.eventId}`}
                    role="row"
                    aria-selected={c.eventId === selectedId}
                    tabIndex={c.eventId === selectedId || (!selectedId && i === 0) ? 0 : -1}
                    onClick={() => setSelectedId(c.eventId)}
                    onKeyDown={(e) => onRowKey(e, i)}
                  >
                    <td role="gridcell" className="cell-time num nowrap">
                      {formatTime(c.commentTimestamp)}
                    </td>
                    <td role="gridcell" className="cell-user nowrap">
                      {c.username ?? t.common.none}
                    </td>
                    <td role="gridcell" className="cell-comment wrap">
                      {c.commentText}
                    </td>
                    <td role="gridcell" className="cell-source">
                      <span className={`chip ${SOURCE_TONE[c.source]}`}>
                        {t.console.sources[c.source]}
                      </span>
                    </td>
                    <td role="gridcell" className="cell-ai">
                      {c.intent ? (
                        <span
                          className={`chip ${INTENT_TONE[c.intent]}`}
                          title={`${Math.round((c.intentConfidence ?? 0) * 100)}%`}
                        >
                          {t.console.intents[c.intent]}
                        </span>
                      ) : (
                        <span className="muted">{t.console.unclassified}</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {matching.length > VISIBLE_LIMIT && (
              <p className="caption center">{fmt(t.console.showingLatest, { n: VISIBLE_LIMIT })}</p>
            )}
          </div>
        )}
      </section>

      <aside className="inspector console__insight" aria-label={t.insight.title}>
        <h2 className="section-title">{t.insight.title}</h2>
        {selected ? (
          <dl className="kv">
            <dt>{t.insight.user}</dt>
            <dd>{selected.username ?? t.common.none}</dd>
            <dt>{t.insight.comment}</dt>
            <dd className="wrap">{selected.commentText}</dd>
            <dt>{t.insight.commentedAt}</dt>
            <dd className="num">{formatTime(selected.commentTimestamp)}</dd>
            <dt>{t.insight.receivedAt}</dt>
            <dd className="num">{formatTime(selected.receivedAt)}</dd>
            <dt>{t.insight.source}</dt>
            <dd>
              <span className={`chip ${SOURCE_TONE[selected.source]}`}>
                {t.console.sources[selected.source]}
              </span>
            </dd>
            <dt>{t.insight.aiStatus}</dt>
            <dd>{selected.intent ? t.console.intents[selected.intent] : t.console.unclassified}</dd>
            <dt>{t.insight.confidence}</dt>
            <dd className="num">
              {selected.intentConfidence === undefined
                ? t.common.none
                : `${Math.round(selected.intentConfidence * 100)}%`}
            </dd>
          </dl>
        ) : (
          <p className="muted">{t.insight.empty}</p>
        )}
        <h3 className="subhead">{t.insight.aiTitle}</h3>
        <p className="muted">{t.insight.aiOff}</p>
        <h3 className="subhead">{t.insight.replyTitle}</h3>
        {selected ? (
          <ReplyCard comment={selected} />
        ) : (
          <p className="muted">{t.insight.replyOff}</p>
        )}
      </aside>
    </div>
  );
}

function PasteBox({ running }: { running: boolean }) {
  const { t, fmt } = useI18n();
  const store = useLiveStore();
  const [text, setText] = useState("");
  const [result, setResult] = useState<string>();
  const id = useId();

  const submit = () => {
    const { added, duplicates } = store.submitManual(text);
    setResult(fmt(t.console.pasteResult, { added, dup: duplicates }));
    if (added + duplicates > 0) setText("");
  };

  return (
    <div className="paste">
      <label htmlFor={id} className="paste__label">
        {t.console.pasteLabel}
      </label>
      <textarea
        id={id}
        className="input input--area"
        rows={4}
        spellCheck={false}
        placeholder={t.console.pastePlaceholder}
        value={text}
        disabled={!running}
        onChange={(e) => setText(e.target.value)}
      />
      <div className="actions">
        <span className="caption">{running ? t.console.pasteHelp : t.console.pasteNeedsStart}</span>
        <span className="toolbar__spacer" />
        <button
          type="button"
          className="btn btn--primary"
          disabled={!running || text.trim() === ""}
          onClick={submit}
        >
          {t.console.pasteSubmit}
        </button>
      </div>
      {result && (
        <p className="caption" role="status">
          {result}
        </p>
      )}
    </div>
  );
}
