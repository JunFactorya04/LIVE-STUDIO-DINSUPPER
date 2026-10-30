import {
  BarcodeFormat,
  BinaryBitmap,
  DecodeHintType,
  HTMLCanvasElementLuminanceSource,
  HybridBinarizer,
  MultiFormatReader,
} from "@zxing/library";
import type { Rect } from "./dwell";

// Reads one barcode out of a rectangle of the camera picture. Only that rectangle is looked at,
// so labels that stick out of the scan window or lie behind it do not confuse the result.

const hints = new Map<DecodeHintType, unknown>([
  [DecodeHintType.POSSIBLE_FORMATS, [BarcodeFormat.CODE_128]],
  [DecodeHintType.TRY_HARDER, true],
]);

export function createDecoder() {
  const reader = new MultiFormatReader();
  reader.setHints(hints);
  const canvas = document.createElement("canvas");
  return (video: HTMLVideoElement, crop: Rect): string | undefined => {
    canvas.width = crop.w;
    canvas.height = crop.h;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) return undefined;
    ctx.drawImage(video, crop.x, crop.y, crop.w, crop.h, 0, 0, crop.w, crop.h);
    try {
      const bitmap = new BinaryBitmap(
        new HybridBinarizer(new HTMLCanvasElementLuminanceSource(canvas)),
      );
      return reader.decodeWithState(bitmap).getText();
    } catch {
      return undefined; // nothing readable in this frame
    }
  };
}
