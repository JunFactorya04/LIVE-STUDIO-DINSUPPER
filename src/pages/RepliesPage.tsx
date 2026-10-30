import { useId, useMemo, useState } from "react";
import { EmptyState } from "../components/States";
import { useI18n } from "../i18n";
import { useLiveSession } from "../live/useLiveSession";
import { loadPolicy, savePolicy } from "../replies/suggest";
import { ReplyCard } from "./ReplyCard";

export function RepliesPage() {
  const { t, formatTime } = useI18n();
  const s = useLiveSession();
  const [policy, setPolicy] = useState(loadPolicy);
  const id = useId();
  const r = t.replies;

  const items = useMemo(() => {
    const byKey = new Map(s.comments.map((c) => [`${c.source}|${c.eventId}`, c]));
    const seen = new Set<string>();
    const out = [];
    for (const rep of [...s.replies].reverse()) {
      const key = `${rep.source}|${rep.eventId}`;
      const comment = byKey.get(key);
      if (!comment || seen.has(key)) continue;
      seen.add(key);
      out.push(comment);
    }
    return out;
  }, [s.replies, s.comments]);

  return (
    <div className="page page--no-inspector orders">
      <section className="box orders__box">
        <p className="banner banner--info" role="note">
          {r.notice}
        </p>
        <div className="field">
          <label htmlFor={id}>{r.policyTitle}</label>
          <textarea
            id={id}
            className="input input--area"
            rows={4}
            placeholder={r.policyPlaceholder}
            value={policy}
            onChange={(e) => {
              setPolicy(e.target.value);
              savePolicy(e.target.value);
            }}
          />
          <span className="caption">{r.policyHelp}</span>
        </div>
        {items.length === 0 ? (
          <EmptyState title={r.emptyTitle} hint={r.emptyHint} />
        ) : (
          <ul className="reply-list">
            {items.map((c) => (
              <li key={`${c.source}-${c.eventId}`} className="reply-list__item">
                <p className="reply-list__comment">
                  <strong>{c.username ?? t.common.none}</strong>{" "}
                  <span className="muted num">{formatTime(c.commentTimestamp)}</span>
                  <br />
                  {c.commentText}
                </p>
                <ReplyCard comment={c} />
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
