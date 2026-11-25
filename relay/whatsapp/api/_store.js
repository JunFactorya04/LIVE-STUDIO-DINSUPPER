// Tiny queue on Upstash Redis (REST API), so the relay needs no packages.
const URL = process.env.UPSTASH_REDIS_REST_URL;
const TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN;
const KEY = "live-studio:wa-inbox";
const MAX = 500;

async function call(path, body) {
  const r = await fetch(`${URL}${path}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`store ${r.status}`);
  return r.json();
}

export async function push(messages) {
  if (messages.length === 0) return;
  await call("/multi-exec", [
    ["RPUSH", KEY, ...messages.map((m) => JSON.stringify(m))],
    ["LTRIM", KEY, String(-MAX), "-1"],
  ]);
}

export async function take(n = 50) {
  const res = await call("/multi-exec", [
    ["LRANGE", KEY, "0", String(n - 1)],
    ["LTRIM", KEY, String(n), "-1"],
  ]);
  const items = res?.[0]?.result ?? [];
  return items.flatMap((s) => {
    try {
      return [JSON.parse(s)];
    } catch {
      return [];
    }
  });
}
