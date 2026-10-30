import { useEffect, useState } from "react";
import { useI18n } from "../i18n";
import type { LiveCommentEvent } from "../live/types";
import { useLiveSession, useLiveStore } from "../live/useLiveSession";
import type { ReplyStatus } from "../replies/types";

const TONE: Record<ReplyStatus, string> = {
  DRAFT: "tone-blue",
  COPIED: "tone-green",
  REJECTED: "tone-gray",
};

/** Reply draft for one comment: suggest, edit, copy, reject. There is no send button on purpose. */
export function ReplyCard({ comment }: { comment: LiveCommentEvent }) {
  const { t } = useI18n();
  const store = useLiveStore();
  const s = useLiveSession();
  const reply = [...s.replies]
    .reverse()
    .find((r) => r.eventId === comment.eventId && r.source === comment.source);
  const [text, setText] = useState(reply?.text ?? "");
  const [note, setNote] = useState<string>();
  const busy = s.suggestingFor === comment.eventId;
  const r = t.replies;

  // Follow the stored text when it changes; forget the note only for another reply.
  useEffect(() => setText(reply?.text ?? ""), [reply?.text]);
  useEffect(() => setNote(undefined), [reply?.id, comment.eventId]);

  const copy = async () => {
    if (!reply) return;
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      setNote(r.copyFailed);
      return;
    }
    // Save an edit first, then record the copy. Copied is not sent.
    if (text.trim() !== reply.text) store.updateReply(reply.id, { text });
    store.updateReply(reply.id, { status: "COPIED" });
    setNote(r.copied);
  };

  const suggest = () => void store.suggestReply(comment.eventId, comment.source);

  if (!reply) {
    return (
      <div className="reply">
        <button type="button" className="btn" disabled={busy} onClick={suggest} title={r.privacy}>
          {busy ? r.suggesting : r.suggest}
        </button>
        <p className="caption">{r.privacy}</p>
      </div>
    );
  }
  return (
    <div className="reply">
      <div className="reply__head">
        <span className={`chip ${TONE[reply.status]}`}>{r.status[reply.status]}</span>
      </div>
      <textarea
        className="input input--area"
        rows={3}
        aria-label={r.textLabel}
        value={text}
        disabled={reply.status === "REJECTED"}
        onChange={(e) => setText(e.target.value)}
      />
      <div className="actions">
        <button
          type="button"
          className="btn btn--primary"
          disabled={text.trim() === "" || reply.status === "REJECTED"}
          onClick={() => void copy()}
        >
          {r.copy}
        </button>
        <button
          type="button"
          className="btn"
          disabled={text.trim() === "" || text.trim() === reply.text || reply.status === "REJECTED"}
          onClick={() => store.updateReply(reply.id, { text })}
        >
          {r.saveEdit}
        </button>
        <button
          type="button"
          className="btn"
          disabled={reply.status === "REJECTED"}
          onClick={() => store.updateReply(reply.id, { status: "REJECTED" })}
        >
          {r.reject}
        </button>
        <button type="button" className="btn" disabled={busy} onClick={suggest}>
          {busy ? r.suggesting : r.again}
        </button>
      </div>
      <p className="caption">{r.notSent}</p>
      {note && (
        <p className="caption" role="status">
          {note}
        </p>
      )}
    </div>
  );
}
