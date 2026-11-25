import { timingSafeEqual } from "node:crypto";
import { take } from "./_store.js";

// LIVE STUDIO asks here every few seconds for new messages (and they are removed once given).

function allowed(header) {
  const secret = process.env.RELAY_SECRET ?? "";
  const got = (header ?? "").replace(/^Bearer\s+/i, "");
  const a = Buffer.from(secret);
  const b = Buffer.from(got);
  return secret.length >= 24 && a.length === b.length && timingSafeEqual(a, b);
}

export async function GET(request) {
  if (!allowed(request.headers.get("authorization"))) {
    return new Response("unauthorized", { status: 401 });
  }
  const messages = await take(50);
  return Response.json({ messages });
}
