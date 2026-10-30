import { useCallback, useEffect, useRef, useState } from "react";
import { useI18n } from "../i18n";
import { createDecoder } from "./decode";
import { createDwell, cropRect } from "./dwell";

// Camera scanner for a phone: the picture is blurred everywhere except a scan window, a bar
// sweeps the window, and a code counts only after it has stayed steady in the window for 3 s.
// Only the window is decoded, so other labels around or under it are ignored.

const HOLD_MS = 3000;
const TICK_MS = 120;

export const cameraSupported = (): boolean =>
  typeof navigator !== "undefined" &&
  typeof window !== "undefined" &&
  window.isSecureContext &&
  !!navigator.mediaDevices?.getUserMedia;

export function CameraButton({
  onScan,
  accept,
}: {
  onScan: (code: string) => void;
  /** Only codes this accepts count, for example the labels this app printed. */
  accept?: (code: string) => boolean;
}) {
  const { t } = useI18n();
  const c = t.camera;
  const [open, setOpen] = useState(false);
  const [hint, setHint] = useState(false);
  return (
    <>
      <button
        type="button"
        className="btn"
        onClick={() => (cameraSupported() ? setOpen(true) : setHint(true))}
      >
        {c.open}
      </button>
      {hint && !open && (
        <p className="note note--error" role="alert">
          {c.needHttps}
        </p>
      )}
      {open && <Scanner onScan={onScan} accept={accept} onClose={() => setOpen(false)} />}
    </>
  );
}

function Scanner({
  onScan,
  accept,
  onClose,
}: {
  onScan: (code: string) => void;
  accept?: (code: string) => boolean;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const c = t.camera;
  const video = useRef<HTMLVideoElement>(null);
  const view = useRef<HTMLDivElement>(null);
  const frame = useRef<HTMLDivElement>(null);
  const [progress, setProgress] = useState(0);
  const [seen, setSeen] = useState<string>();
  const [last, setLast] = useState<string>();
  const [count, setCount] = useState(0);
  const [error, setError] = useState<string>();
  const handler = useRef(onScan);
  handler.current = onScan;
  const accepts = useRef(accept);
  accepts.current = accept;

  const close = useCallback(() => onClose(), [onClose]);

  useEffect(() => {
    let stream: MediaStream | undefined;
    let timer: number | undefined;
    let stopped = false;
    const dwell = createDwell(HOLD_MS);
    const decode = createDecoder();

    const tick = () => {
      const v = video.current;
      const box = view.current;
      const win = frame.current;
      if (stopped || !v || !box || !win) return;
      let code: string | undefined;
      if (v.readyState >= 2 && v.videoWidth > 0) {
        const b = box.getBoundingClientRect();
        const w = win.getBoundingClientRect();
        const crop = cropRect(
          { w: b.width, h: b.height },
          { x: w.left - b.left, y: w.top - b.top, w: w.width, h: w.height },
          { w: v.videoWidth, h: v.videoHeight },
        );
        code = decode(v, crop);
        if (code && accepts.current && !accepts.current(code)) code = undefined;
      }
      const s = dwell.feed(code, performance.now());
      setProgress(s.progress);
      setSeen(s.code);
      if (s.done && s.code) {
        navigator.vibrate?.(80);
        setLast(s.code);
        setCount((n) => n + 1);
        handler.current(s.code);
      }
      timer = window.setTimeout(tick, TICK_MS);
    };

    navigator.mediaDevices
      .getUserMedia({
        video: {
          facingMode: { ideal: "environment" },
          width: { ideal: 1280 },
          height: { ideal: 720 },
        },
        audio: false,
      })
      .then(async (s) => {
        if (stopped) return s.getTracks().forEach((x) => x.stop());
        stream = s;
        const v = video.current;
        if (!v) return;
        v.srcObject = s;
        await v.play().catch(() => undefined);
        tick();
      })
      .catch((e: unknown) => {
        const name = (e as { name?: string })?.name;
        setError(name === "NotAllowedError" ? c.denied : c.noCamera);
      });

    return () => {
      stopped = true;
      if (timer) window.clearTimeout(timer);
      stream?.getTracks().forEach((x) => x.stop());
    };
  }, [c.denied, c.noCamera]);

  return (
    <div className="cam" role="dialog" aria-modal="true" aria-label={c.title} ref={view}>
      <video ref={video} className="cam__video" playsInline muted autoPlay />
      <div className="cam__shade cam__shade--top" />
      <div className="cam__shade cam__shade--bottom" />
      <div className="cam__shade cam__shade--left" />
      <div className="cam__shade cam__shade--right" />
      <div className="cam__window" ref={frame} data-hit={progress >= 1 ? "1" : "0"}>
        <i className="cam__corner cam__corner--tl" />
        <i className="cam__corner cam__corner--tr" />
        <i className="cam__corner cam__corner--bl" />
        <i className="cam__corner cam__corner--br" />
        <i className="cam__bar" />
      </div>
      <div className="cam__panel">
        {error ? (
          <p className="cam__msg" role="alert">
            {error}
          </p>
        ) : (
          <>
            <p className="cam__msg">{seen ? `${c.holding} ${seen}` : c.hold}</p>
            <div
              className="cam__progress"
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={Math.round(progress * 100)}
            >
              <i style={{ width: `${Math.round(progress * 100)}%` }} />
            </div>
            {last && (
              <p className="cam__last" aria-live="polite">
                ✓ {last} · {count}
              </p>
            )}
          </>
        )}
        <button type="button" className="btn btn--primary" onClick={close}>
          {c.close}
        </button>
      </div>
    </div>
  );
}
