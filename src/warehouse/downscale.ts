// Shrinks a picked or captured photo to a small JPEG data: URL before it is sent to the
// backend — small enough to sit in a SQLite TEXT column and round-trip over a phone's share
// link, while still looking sharp as a card/row thumbnail.

const MAX_SIDE = 640;
const QUALITY = 0.72;

export async function downscaleImage(file: File | Blob): Promise<string> {
  const bitmap = await createImageBitmap(file);
  try {
    const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
    const w = Math.max(1, Math.round(bitmap.width * scale));
    const h = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("NO_CANVAS");
    ctx.drawImage(bitmap, 0, 0, w, h);
    return canvas.toDataURL("image/jpeg", QUALITY);
  } finally {
    bitmap.close?.();
  }
}
