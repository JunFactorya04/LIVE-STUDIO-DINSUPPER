//! AI providers the seller can plug their own key into (BYOK). Requests are built and answers
//! parsed here, in Rust, so the key never reaches the frontend or any log. Adding a vendor that
//! speaks the OpenAI-style API is one row in `PROVIDERS` plus one key slot in `secrets.rs`.

use crate::secrets::SecretStore;
use serde_json::{json, Value};
use std::time::Duration;

#[derive(Debug, Clone, Copy, PartialEq)]
pub enum Kind {
    /// POST {base}/chat/completions (OpenAI, DeepSeek and many others).
    OpenAiCompat,
    /// POST {base}/v1/messages
    Claude,
    /// POST {base}/v1beta/models/{model}:generateContent
    Gemini,
}

pub struct Provider {
    /// Also the name of the key slot.
    pub id: &'static str,
    pub kind: Kind,
    pub base: &'static str,
    /// Default model. Vendors rename models often, so the seller can override it in Settings.
    pub default_model: &'static str,
    /// OpenAI wants `max_completion_tokens`; the others still use `max_tokens`.
    pub token_param: &'static str,
}

pub const PROVIDERS: &[Provider] = &[
    Provider {
        id: "openai",
        kind: Kind::OpenAiCompat,
        base: "https://api.openai.com/v1",
        default_model: "gpt-4o-mini",
        token_param: "max_completion_tokens",
    },
    Provider {
        id: "claude",
        kind: Kind::Claude,
        base: "https://api.anthropic.com",
        default_model: "claude-haiku-5-5",
        token_param: "max_tokens",
    },
    Provider {
        id: "gemini",
        kind: Kind::Gemini,
        base: "https://generativelanguage.googleapis.com",
        default_model: "gemini-2.5-flash",
        token_param: "maxOutputTokens",
    },
    Provider {
        id: "deepseek",
        kind: Kind::OpenAiCompat,
        base: "https://api.deepseek.com",
        default_model: "deepseek-chat",
        token_param: "max_tokens",
    },
];

pub fn provider(id: &str) -> Option<&'static Provider> {
    PROVIDERS.iter().find(|p| p.id == id)
}

pub const MAX_SYSTEM_CHARS: usize = 4_000;
pub const MAX_PROMPT_CHARS: usize = 20_000;
pub const MAX_TOKENS_CAP: u32 = 1_024;

/// Short, translatable error codes. They never contain the key or the vendor's response body.
#[derive(Debug, PartialEq)]
pub enum AiError {
    UnknownProvider,
    BadModel,
    TooLong,
    NoKey,
    Auth,
    Quota,
    RateLimit,
    BadRequest,
    Server,
    Timeout,
    Network,
    BadResponse,
    Keychain,
}

impl AiError {
    pub fn code(&self) -> &'static str {
        match self {
            AiError::UnknownProvider => "UNKNOWN_PROVIDER",
            AiError::BadModel => "BAD_MODEL",
            AiError::TooLong => "TOO_LONG",
            AiError::NoKey => "NO_KEY",
            AiError::Auth => "AUTH",
            AiError::Quota => "QUOTA",
            AiError::RateLimit => "RATE_LIMIT",
            AiError::BadRequest => "BAD_REQUEST",
            AiError::Server => "SERVER",
            AiError::Timeout => "TIMEOUT",
            AiError::Network => "NETWORK",
            AiError::BadResponse => "BAD_RESPONSE",
            AiError::Keychain => "KEYCHAIN",
        }
    }
}

pub fn status_error(status: u16) -> AiError {
    match status {
        401 | 403 => AiError::Auth,
        402 => AiError::Quota,
        429 => AiError::RateLimit,
        400 | 404 | 422 => AiError::BadRequest,
        s if s >= 500 => AiError::Server,
        _ => AiError::BadResponse,
    }
}

/// The model goes into a URL (Gemini), so only plain model-name characters are allowed.
pub fn valid_model(model: &str) -> bool {
    !model.is_empty()
        && model.len() <= 100
        && model
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '-' | '_' | ':' | '/'))
        && !model.contains("..")
}

pub struct BuiltRequest {
    pub url: String,
    pub headers: Vec<(&'static str, String)>,
    pub body: Value,
}

pub fn build_request(
    p: &Provider,
    base: &str,
    model: &str,
    key: &str,
    system: &str,
    prompt: &str,
    max_tokens: u32,
) -> BuiltRequest {
    let base = base.trim_end_matches('/');
    match p.kind {
        Kind::OpenAiCompat => BuiltRequest {
            url: format!("{base}/chat/completions"),
            headers: vec![("authorization", format!("Bearer {key}"))],
            body: json!({
                "model": model,
                (p.token_param): max_tokens,
                "messages": [
                    { "role": "system", "content": system },
                    { "role": "user", "content": prompt },
                ],
            }),
        },
        Kind::Claude => BuiltRequest {
            url: format!("{base}/v1/messages"),
            headers: vec![
                ("x-api-key", key.to_string()),
                ("anthropic-version", "2023-06-01".to_string()),
            ],
            body: json!({
                "model": model,
                (p.token_param): max_tokens,
                "system": system,
                "messages": [{ "role": "user", "content": prompt }],
            }),
        },
        Kind::Gemini => BuiltRequest {
            url: format!("{base}/v1beta/models/{model}:generateContent"),
            headers: vec![("x-goog-api-key", key.to_string())],
            body: json!({
                "systemInstruction": { "parts": [{ "text": system }] },
                "contents": [{ "role": "user", "parts": [{ "text": prompt }] }],
                "generationConfig": { (p.token_param): max_tokens },
            }),
        },
    }
}

/// Pull the answer text out of a vendor response.
pub fn parse_response(kind: Kind, v: &Value) -> Result<String, AiError> {
    let text = match kind {
        Kind::OpenAiCompat => v
            .pointer("/choices/0/message/content")
            .and_then(Value::as_str)
            .map(str::to_string),
        Kind::Claude => v.get("content").and_then(Value::as_array).map(|blocks| {
            blocks
                .iter()
                .filter(|b| b.get("type").and_then(Value::as_str) == Some("text"))
                .filter_map(|b| b.get("text").and_then(Value::as_str))
                .collect::<String>()
        }),
        Kind::Gemini => v
            .pointer("/candidates/0/content/parts")
            .and_then(Value::as_array)
            .map(|parts| {
                parts
                    .iter()
                    .filter_map(|p| p.get("text").and_then(Value::as_str))
                    .collect::<String>()
            }),
    };
    match text.map(|t| t.trim().to_string()) {
        Some(t) if !t.is_empty() => Ok(t),
        _ => Err(AiError::BadResponse),
    }
}

/// Ask one provider with the seller's own key. `base_override` is for tests only.
pub async fn complete(
    store: &dyn SecretStore,
    provider_id: &str,
    model: Option<&str>,
    system: &str,
    prompt: &str,
    max_tokens: u32,
    base_override: Option<&str>,
) -> Result<String, AiError> {
    let p = provider(provider_id).ok_or(AiError::UnknownProvider)?;
    let model = match model.map(str::trim).filter(|m| !m.is_empty()) {
        Some(m) if valid_model(m) => m,
        Some(_) => return Err(AiError::BadModel),
        None => p.default_model,
    };
    if system.chars().count() > MAX_SYSTEM_CHARS || prompt.chars().count() > MAX_PROMPT_CHARS {
        return Err(AiError::TooLong);
    }
    let key = store
        .get(p.id)
        .map_err(|_| AiError::Keychain)?
        .ok_or(AiError::NoKey)?;

    let req = build_request(
        p,
        base_override.unwrap_or(p.base),
        model,
        &key,
        system,
        prompt,
        max_tokens.clamp(1, MAX_TOKENS_CAP),
    );
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(30))
        .build()
        .map_err(|_| AiError::Network)?;
    let mut call = client
        .post(&req.url)
        .header("content-type", "application/json")
        .body(req.body.to_string());
    for (k, v) in &req.headers {
        call = call.header(*k, v);
    }
    let res = call.send().await.map_err(|e| {
        if e.is_timeout() {
            AiError::Timeout
        } else {
            AiError::Network
        }
    })?;
    let status = res.status().as_u16();
    if !(200..300).contains(&status) {
        return Err(status_error(status));
    }
    let body = res.text().await.map_err(|_| AiError::Network)?;
    let json: Value = serde_json::from_str(&body).map_err(|_| AiError::BadResponse)?;
    parse_response(p.kind, &json)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::secrets::MemoryStore;
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    use tokio::net::TcpListener;

    fn p(id: &str) -> &'static Provider {
        provider(id).unwrap()
    }

    #[test]
    fn every_provider_has_a_key_slot() {
        for pr in PROVIDERS {
            assert!(crate::secrets::valid_slot(pr.id), "{}", pr.id);
        }
    }

    #[test]
    fn openai_compatible_request_and_response() {
        let r = build_request(p("deepseek"), "https://x.test/", "m1", "K", "sys", "hi", 50);
        assert_eq!(r.url, "https://x.test/chat/completions");
        assert_eq!(r.headers[0], ("authorization", "Bearer K".to_string()));
        assert_eq!(r.body["max_tokens"], 50);
        assert_eq!(r.body["messages"][0]["role"], "system");
        let o = build_request(p("openai"), "https://x.test", "m1", "K", "s", "h", 7);
        assert_eq!(o.body["max_completion_tokens"], 7);
        let ok = json!({"choices":[{"message":{"content":" hello "}}]});
        assert_eq!(parse_response(Kind::OpenAiCompat, &ok).unwrap(), "hello");
        assert_eq!(
            parse_response(Kind::OpenAiCompat, &json!({"choices":[]})),
            Err(AiError::BadResponse)
        );
    }

    #[test]
    fn claude_request_and_response() {
        let r = build_request(p("claude"), "https://x.test", "m", "K", "sys", "hi", 10);
        assert_eq!(r.url, "https://x.test/v1/messages");
        assert!(r.headers.contains(&("x-api-key", "K".to_string())));
        assert!(r.headers.iter().any(|(k, _)| *k == "anthropic-version"));
        assert_eq!(r.body["system"], "sys");
        let ok = json!({"content":[{"type":"text","text":"a"},{"type":"tool_use"},{"type":"text","text":"b"}]});
        assert_eq!(parse_response(Kind::Claude, &ok).unwrap(), "ab");
    }

    #[test]
    fn gemini_request_and_response() {
        let r = build_request(p("gemini"), "https://x.test", "gem-1", "K", "sys", "hi", 10);
        assert_eq!(r.url, "https://x.test/v1beta/models/gem-1:generateContent");
        assert!(r.headers.contains(&("x-goog-api-key", "K".to_string())));
        assert_eq!(r.body["systemInstruction"]["parts"][0]["text"], "sys");
        assert_eq!(r.body["generationConfig"]["maxOutputTokens"], 10);
        let ok = json!({"candidates":[{"content":{"parts":[{"text":"x"},{"text":"y"}]}}]});
        assert_eq!(parse_response(Kind::Gemini, &ok).unwrap(), "xy");
        // A blocked answer has no parts: say so instead of returning an empty string.
        assert_eq!(
            parse_response(
                Kind::Gemini,
                &json!({"candidates":[{"finishReason":"SAFETY"}]})
            ),
            Err(AiError::BadResponse)
        );
    }

    #[test]
    fn models_and_status_codes() {
        assert!(valid_model("gpt-4o-mini") && valid_model("models/x:1.5") && valid_model("a_b"));
        for bad in ["", "a b", "x?key=1", "../etc", "a#b", "é"] {
            assert!(!valid_model(bad), "{bad}");
        }
        assert_eq!(status_error(401), AiError::Auth);
        assert_eq!(status_error(402), AiError::Quota);
        assert_eq!(status_error(429), AiError::RateLimit);
        assert_eq!(status_error(404), AiError::BadRequest);
        assert_eq!(status_error(503), AiError::Server);
    }

    /// One-shot local HTTP server: returns the raw request it got and answers with `reply`.
    async fn serve(
        status: &'static str,
        reply: &'static str,
    ) -> (String, tokio::task::JoinHandle<String>) {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let base = format!("http://{}", listener.local_addr().unwrap());
        let h = tokio::spawn(async move {
            let (mut s, _) = listener.accept().await.unwrap();
            let mut buf = vec![0u8; 16 * 1024];
            let mut got = 0;
            loop {
                let n = s.read(&mut buf[got..]).await.unwrap();
                got += n;
                let text = String::from_utf8_lossy(&buf[..got]).to_string();
                if let Some(i) = text.find("\r\n\r\n") {
                    let len = text
                        .lines()
                        .find_map(|l| {
                            l.to_lowercase()
                                .strip_prefix("content-length:")
                                .map(|v| v.trim().parse::<usize>().unwrap())
                        })
                        .unwrap_or(0);
                    if got >= i + 4 + len {
                        break;
                    }
                }
                if n == 0 {
                    break;
                }
            }
            let res = format!(
                "HTTP/1.1 {status}\r\ncontent-type: application/json\r\ncontent-length: {}\r\nconnection: close\r\n\r\n{reply}",
                reply.len()
            );
            s.write_all(res.as_bytes()).await.unwrap();
            String::from_utf8_lossy(&buf[..got]).to_string()
        });
        (base, h)
    }

    #[tokio::test]
    async fn complete_sends_the_key_and_returns_the_answer() {
        let store = MemoryStore::default();
        store.set("deepseek", "sk-secret").unwrap();
        let (base, seen) = serve("200 OK", r#"{"choices":[{"message":{"content":"OK"}}]}"#).await;
        let out = complete(&store, "deepseek", None, "sys", "ping", 16, Some(&base)).await;
        assert_eq!(out.unwrap(), "OK");
        let raw = seen.await.unwrap().to_lowercase();
        assert!(raw.starts_with("post /chat/completions"));
        assert!(raw.contains("authorization: bearer sk-secret"));
        assert!(raw.contains("\"model\":\"deepseek-chat\""));
    }

    #[tokio::test]
    async fn complete_maps_failures_without_leaking_the_key() {
        let store = MemoryStore::default();
        assert_eq!(
            complete(&store, "claude", None, "s", "p", 8, None).await,
            Err(AiError::NoKey)
        );
        assert_eq!(
            complete(&store, "nope", None, "s", "p", 8, None).await,
            Err(AiError::UnknownProvider)
        );
        store.set("claude", "sk-secret").unwrap();
        assert_eq!(
            complete(&store, "claude", Some("bad model"), "s", "p", 8, None).await,
            Err(AiError::BadModel)
        );
        let long = "x".repeat(MAX_PROMPT_CHARS + 1);
        assert_eq!(
            complete(&store, "claude", None, "s", &long, 8, None).await,
            Err(AiError::TooLong)
        );

        let (base, _) = serve("401 Unauthorized", r#"{"error":"sk-secret is bad"}"#).await;
        assert_eq!(
            complete(&store, "claude", None, "s", "p", 8, Some(&base)).await,
            Err(AiError::Auth)
        );

        // Nothing listens here: a network error that does not mention the key.
        let e = complete(
            &store,
            "claude",
            None,
            "s",
            "p",
            8,
            Some("http://127.0.0.1:1"),
        )
        .await
        .unwrap_err();
        assert_eq!(e, AiError::Network);
        assert!(!e.code().contains("sk-secret"));
    }
}
