import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Icon } from "../components/Icon";
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
        className="btn btn--scan btn--icon-scan"
        aria-label={c.open}
        title={c.open}
        onClick={() => (cameraSupported() ? setOpen(true) : setHint(true))}
      >
        <svg
          className="icon"
          width="20"
          height="20"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.9"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
          focusable="false"
        >
          <path d="M4 8V5a1 1 0 0 1 1-1h3M20 8V5a1 1 0 0 0-1-1h-3M4 16v3a1 1 0 0 0 1 1h3M20 16v3a1 1 0 0 1-1 1h-3M7 12h10" />
        </svg>
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

export function Scanner({
  onScan,
  accept,
  onClose,
  label,
}: {
  onScan: (code: string) => void;
  accept?: (code: string) => boolean;
  onClose: () => void;
  /** What the scans are for, shown over the picture (the phone scan screen's mode). */
  label?: string;
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
  // The flashlight, where the phone's camera has one (Android Chrome; Safari does not offer it).
  const track = useRef<MediaStreamTrack>();
  const [torch, setTorch] = useState(false);
  const [torchOn, setTorchOn] = useState(false);
  const toggleTorch = async () => {
    const next = !torchOn;
    try {
      await track.current?.applyConstraints({
        advanced: [{ torch: next } as MediaTrackConstraintSet],
      });
      setTorchOn(next);
    } catch {
      setTorch(false);
    }
  };

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
        const tr = s.getVideoTracks()[0];
        track.current = tr;
        const caps = tr?.getCapabilities?.() as { torch?: boolean } | undefined;
        setTorch(Boolean(caps?.torch));
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

  // Rendered at the end of <body>: a full-screen layer must not depend on where in the page the
  // button sits (an ancestor with a transform would otherwise pin it inside that box).
  return createPortal(
    <div className="cam" role="dialog" aria-modal="true" aria-label={label ?? c.title} ref={view}>
      <video ref={video} className="cam__video" playsInline muted autoPlay />
      <div className="cam__shade cam__shade--top" />
      <div className="cam__shade cam__shade--bottom" />
      <div className="cam__shade cam__shade--left" />
      <div className="cam__shade cam__shade--right" />
      <div className="cam__top">
        <button type="button" className="cam__round" aria-label={c.close} onClick={close}>
          <Icon name="back" size={20} />
        </button>
        <p className="cam__title">{label ?? c.title}</p>
        {torch ? (
          <button
            type="button"
            className="cam__round"
            aria-label={c.torch}
            aria-pressed={torchOn}
            onClick={() => void toggleTorch()}
          >
            <Icon name="flash" size={18} />
          </button>
        ) : (
          <span className="cam__round cam__round--ghost" aria-hidden="true" />
        )}
      </div>
      <div className="cam__window" ref={frame} data-hit={progress >= 1 ? "1" : "0"}>
        <i className="cam__corner cam__corner--tl" />
        <i className="cam__corner cam__corner--tr" />
        <i className="cam__corner cam__corner--bl" />
        <i className="cam__corner cam__corner--br" />
        <i className="cam__bar" />
        <span
          className="cam__fill"
          role="progressbar"
          aria-label={c.hold}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(progress * 100)}
        >
          <i style={{ transform: `scaleX(${progress})` }} />
        </span>
      </div>
      <p
        className={`cam__hint${error ? " cam__hint--error" : ""}`}
        role={error ? "alert" : undefined}
      >
        {error ?? (seen ? `${c.holding} ${seen}` : c.hold)}
      </p>
      <div className="cam__panel">
        {last && (
          <p className="cam__last" aria-live="polite">
            <Icon name="checkCircle" size={18} />
            <span className="cam__last-code">{last}</span>
            <span className="cam__count">{count}</span>
          </p>
        )}
        <button type="button" className="btn btn--primary cam__done" onClick={close}>
          {c.close}
        </button>
      </div>
    </div>,
    document.body,
  );
}
