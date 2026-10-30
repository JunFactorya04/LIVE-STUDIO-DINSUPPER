// "Hold it steady": a code is accepted only after the same code has been seen continuously for
// `holdMs`. A short gap (a blurred frame) does not restart the count; a different code does. After
// a code is accepted it must leave the frame before it can be accepted again, so one label is not
// scanned twice by accident.

export interface DwellState {
  code?: string;
  /** 0 to 1. */
  progress: number;
  /** True exactly once per accepted code. */
  done: boolean;
}

export function createDwell(holdMs = 3000, graceMs = 600) {
  let current: string | undefined;
  let since = 0;
  let lastSeen = 0;
  let locked: string | undefined;

  return {
    feed(code: string | undefined, now: number): DwellState {
      if (code !== undefined && code === locked) {
        lastSeen = now;
        return { code, progress: 0, done: false };
      }
      if (code === undefined) {
        if (now - lastSeen > graceMs) {
          current = undefined;
          locked = undefined;
        }
        if (current === undefined) return { progress: 0, done: false };
        return { code: current, progress: Math.min(1, (now - since) / holdMs), done: false };
      }
      lastSeen = now;
      if (code !== current) {
        current = code;
        since = now;
      }
      const progress = Math.min(1, (now - since) / holdMs);
      if (progress >= 1) {
        locked = code;
        current = undefined;
        return { code, progress: 1, done: true };
      }
      return { code, progress, done: false };
    },
    reset() {
      current = undefined;
      locked = undefined;
    },
  };
}

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * The scan window (in screen pixels, relative to the video element) as a rectangle of the camera
 * picture, for a video shown with `object-fit: cover`.
 */
export function cropRect(
  view: { w: number; h: number },
  win: Rect,
  video: { w: number; h: number },
): Rect {
  const scale = Math.max(view.w / video.w, view.h / video.h);
  const offX = (view.w - video.w * scale) / 2;
  const offY = (view.h - video.h * scale) / 2;
  const x = Math.max(0, Math.round((win.x - offX) / scale));
  const y = Math.max(0, Math.round((win.y - offY) / scale));
  const w = Math.min(video.w - x, Math.round(win.w / scale));
  const h = Math.min(video.h - y, Math.round(win.h / scale));
  return { x, y, w: Math.max(1, w), h: Math.max(1, h) };
}
