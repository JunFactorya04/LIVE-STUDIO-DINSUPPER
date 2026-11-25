import { createHmac, timingSafeEqual } from "node:crypto";
import { push } from "./_store.js";

// Meta calls this URL: GET once to verify it, then POST for every incoming WhatsApp message.
// Only text messages are kept (sender number + text); everything else is ignored.

export function GET(request) {
  const q = new URL(request.url).searchParams;
  if (
    q.get("hub.mode") === "subscribe" &&
    q.get("hub.verify_token") === process.env.WA_VERIFY_TOKEN
  ) {
    return new Response(q.get("hub.challenge") ?? "", { status: 200 });
  }
  return new Response("forbidden", { status: 403 });
}

function signed(raw, header) {
  const secret = process.env.WA_APP_SECRET;
  if (!secret || !header?.startsWith("sha256=")) return false;
  const want = Buffer.from(createHmac("sha256", secret).update(raw).digest("hex"));
  const got = Buffer.from(header.slice(7));
  return want.length === got.length && timingSafeEqual(want, got);
}

export async function POST(request) {
  const raw = await request.text();
  if (!signed(raw, request.headers.get("x-hub-signature-256"))) {
    return new Response("bad signature", { status: 401 });
  }
  let body;
  try {
    body = JSON.parse(raw);
  } catch {
    return new Response("ok");
  }
  const messages = [];
  for (const entry of body.entry ?? []) {
    for (const change of entry.changes ?? []) {
      for (const m of change.value?.messages ?? []) {
        if (m.type === "text" && m.text?.body) {
          messages.push({
            id: m.id,
            from: m.from,
            text: String(m.text.body).slice(0, 4000),
            at: m.timestamp,
          });
        }
      }
    }
  }
  await push(messages);
  return new Response("ok");
}
