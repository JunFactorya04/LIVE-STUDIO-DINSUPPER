// Validation of the LIVE URL / username a seller enters.
// A URL is only a reference to the session; it is never a credential.

export type ConfigIssue = "NEED_URL_OR_USERNAME" | "URL_FORMAT" | "USERNAME_FORMAT";

export interface ConfigValidation {
  ok: boolean;
  issues: ConfigIssue[];
  liveUrl?: string;
  username?: string;
}

const USERNAME_RE = /^[A-Za-z0-9._]{2,24}$/;

function parseLiveUrl(raw: string): { url: string; username: string } | undefined {
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return undefined;
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return undefined;
  const host = parsed.hostname.toLowerCase();
  if (host !== "tiktok.com" && !host.endsWith(".tiktok.com")) return undefined;
  const match = /^\/@([A-Za-z0-9._]{2,24})\/live\/?$/.exec(parsed.pathname);
  if (!match) return undefined;
  return { url: `https://www.tiktok.com/@${match[1]}/live`, username: match[1] };
}

export function validateLiveConfig(rawUrl: string, rawUsername: string): ConfigValidation {
  const urlText = rawUrl.trim();
  const userText = rawUsername.trim().replace(/^@/, "");
  const issues: ConfigIssue[] = [];
  let liveUrl: string | undefined;
  let username: string | undefined;

  if (urlText) {
    const parsed = parseLiveUrl(urlText);
    if (parsed) {
      liveUrl = parsed.url;
      username = parsed.username;
    } else {
      issues.push("URL_FORMAT");
    }
  }

  if (userText) {
    if (USERNAME_RE.test(userText)) username = userText;
    else issues.push("USERNAME_FORMAT");
  }

  if (!urlText && !userText) issues.push("NEED_URL_OR_USERNAME");

  return { ok: issues.length === 0, issues, liveUrl, username };
}
