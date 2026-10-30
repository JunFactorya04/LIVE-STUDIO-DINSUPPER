//! Euler Stream comment source (UNOFFICIAL third-party service, not TikTok).
//!
//! Protocol, as documented by Euler Stream and its open-source SDK
//! (github.com/EulerStream/Euler-WebSocket-SDK):
//!  - connect to `wss://ws.eulerstream.com?uniqueId=<handle>&apiKey=<key>`;
//!  - frames are JSON bundles `{ "timestamp": n, "messages": [ { "type", "data" } ] }`;
//!  - a chat comment is `type = "WebcastChatMessage"` with `data.comment`,
//!    `data.user.{uniqueId, nickname}` and `data.common.{msgId, createTime}`;
//!  - the server ends the connection with documented close codes (4404 = streamer not live, ...).
//!
//! This module never logs or returns the API key or the full URL. The key is read from the OS
//! keychain by the command layer and handed in here; nothing sends it to the frontend.

use futures_util::StreamExt;
use serde::Serialize;
use serde_json::Value;
use tokio_tungstenite::tungstenite::Message;

pub const DEFAULT_WS_URL: &str = "wss://ws.eulerstream.com";

const MAX_TEXT_CHARS: usize = 1000;

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct EulerComment {
    pub event_id: String,
    pub username: Option<String>,
    pub display_name: Option<String>,
    pub comment_text: String,
    /// Milliseconds since the Unix epoch, when the message carries a usable time.
    pub comment_timestamp_ms: Option<i64>,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum EulerOut {
    /// `status` is a LiveProviderStatus; `reason` is a stable key the UI translates.
    Status {
        status: &'static str,
        code: Option<u16>,
        reason: Option<&'static str>,
    },
    Comments {
        comments: Vec<EulerComment>,
    },
}

/// What one JSON frame contained.
#[derive(Debug, Default, PartialEq)]
pub struct ParsedFrame {
    pub comments: Vec<EulerComment>,
    /// The service said the room connection is up (`tiktok.connect` or `room.status: connected`).
    pub connected: bool,
}

fn fnv1a(input: &str) -> String {
    let mut h: u32 = 0x811c_9dc5;
    for b in input.as_bytes() {
        h ^= u32::from(*b);
        h = h.wrapping_mul(0x0100_0193);
    }
    format!("{h:08x}")
}

fn text_of(v: &Value) -> Option<String> {
    match v {
        Value::String(s) if !s.is_empty() => Some(s.clone()),
        Value::Number(n) => Some(n.to_string()),
        _ => None,
    }
}

/// `createTime` arrives as a string or number, in milliseconds (or seconds on older schemas).
fn timestamp_ms(v: Option<&Value>) -> Option<i64> {
    let raw: i64 = match v? {
        Value::String(s) => s.parse().ok()?,
        Value::Number(n) => n.as_i64()?,
        _ => return None,
    };
    if raw <= 0 {
        None
    } else if raw < 100_000_000_000 {
        Some(raw * 1000)
    } else {
        Some(raw)
    }
}

fn parse_chat(data: &Value) -> Option<EulerComment> {
    let comment: String = data
        .get("comment")?
        .as_str()?
        .trim()
        .chars()
        .take(MAX_TEXT_CHARS)
        .collect();
    if comment.is_empty() {
        return None;
    }
    let user = data.get("user");
    let username = user.and_then(|u| u.get("uniqueId")).and_then(text_of);
    let display_name = user.and_then(|u| u.get("nickname")).and_then(text_of);
    let common = data.get("common");
    let created = common.and_then(|c| c.get("createTime"));
    let event_id = common
        .and_then(|c| c.get("msgId"))
        .and_then(text_of)
        .map(|id| format!("euler-{id}"))
        .unwrap_or_else(|| {
            format!(
                "euler-h{}",
                fnv1a(&format!(
                    "{}|{}|{}",
                    username.as_deref().unwrap_or(""),
                    comment,
                    created.and_then(text_of).unwrap_or_default()
                ))
            )
        });
    Some(EulerComment {
        event_id,
        username,
        display_name,
        comment_text: comment,
        comment_timestamp_ms: timestamp_ms(created),
    })
}

fn parse_message(msg: &Value, out: &mut ParsedFrame) {
    let Some(kind) = msg.get("type").and_then(Value::as_str) else {
        return;
    };
    let data = msg.get("data").unwrap_or(&Value::Null);
    match kind {
        "WebcastChatMessage" => out.comments.extend(parse_chat(data)),
        "tiktok.connect" => out.connected = true,
        "room.status" => {
            if data.get("state").and_then(Value::as_str) == Some("connected") {
                out.connected = true;
            }
        }
        _ => {}
    }
}

/// Parse one text frame. Accepts a bundle (`messages: [...]`) or a single `{type, data}` message.
/// Anything malformed yields an empty result instead of an error: one bad frame must not
/// end a live session.
pub fn parse_frame(text: &str) -> ParsedFrame {
    let mut out = ParsedFrame::default();
    let Ok(v) = serde_json::from_str::<Value>(text) else {
        return out;
    };
    if let Some(messages) = v.get("messages").and_then(Value::as_array) {
        for m in messages {
            parse_message(m, &mut out);
        }
    } else {
        parse_message(&v, &mut out);
    }
    out
}

/// Map a close code (documented by Euler Stream) to a provider status and a translatable reason.
pub fn close_outcome(code: u16) -> (&'static str, &'static str) {
    match code {
        1000 => ("DISCONNECTED", "NORMAL"),
        4005 => ("DISCONNECTED", "STREAM_END"),
        4404 => ("DISCONNECTED", "NOT_LIVE"),
        4555 => ("DISCONNECTED", "MAX_LIFETIME"),
        4400 => ("ERROR", "INVALID_OPTIONS"),
        4401 => ("ERROR", "INVALID_AUTH"),
        4403 => ("ERROR", "NO_PERMISSION"),
        4429 => ("ERROR", "TOO_MANY_CONNECTIONS"),
        4006 | 4408 => ("ERROR", "TIMEOUT"),
        4500 => ("ERROR", "TIKTOK_CLOSED"),
        1011 | 4556 | 4557 => ("ERROR", "SERVER_ERROR"),
        _ => ("ERROR", "OTHER"),
    }
}

/// A TikTok handle: 2-24 letters, digits, dots, underscores (optional leading @).
pub fn normalize_unique_id(raw: &str) -> Option<String> {
    let id = raw.trim().trim_start_matches('@');
    let ok = (2..=24).contains(&id.len())
        && id
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '.' || c == '_');
    ok.then(|| id.to_string())
}

/// Build the connection URL. Going through `Url` gives the request a proper `/` path
/// (`wss://host/?uniqueId=..`), which is what browsers send for `wss://host?uniqueId=..` too.
pub fn build_url(base: &str, unique_id: &str, api_key: &str) -> Option<String> {
    let mut url = url::Url::parse(base).ok()?;
    url.query_pairs_mut()
        .append_pair("uniqueId", unique_id)
        .append_pair("apiKey", api_key);
    Some(url.into())
}

fn status(status: &'static str, code: Option<u16>, reason: Option<&'static str>) -> EulerOut {
    EulerOut::Status {
        status,
        code,
        reason,
    }
}

/// Run one connection until the server (or network) ends it, reporting through `emit`.
///
/// CONNECTED is only reported on proof from the service: a connect/room.status message, or the
/// first real comment. There is no automatic reconnect: the seller sees why it ended and decides.
pub async fn run_connection(
    base_url: &str,
    unique_id: &str,
    api_key: &str,
    emit: &(dyn Fn(EulerOut) + Send + Sync),
) {
    let Some(url) = build_url(base_url, unique_id, api_key) else {
        emit(status("ERROR", None, Some("INVALID_OPTIONS")));
        return;
    };
    let mut ws = match tokio_tungstenite::connect_async(url).await {
        Ok((ws, _)) => ws,
        Err(_) => {
            // Deliberately generic: the error text could contain the URL (and so the key).
            emit(status("ERROR", None, Some("NETWORK")));
            return;
        }
    };

    let mut confirmed = false;
    loop {
        match ws.next().await {
            Some(Ok(Message::Text(text))) => {
                let frame = parse_frame(&text);
                if !confirmed && (frame.connected || !frame.comments.is_empty()) {
                    confirmed = true;
                    emit(status("CONNECTED", None, None));
                }
                if !frame.comments.is_empty() {
                    emit(EulerOut::Comments {
                        comments: frame.comments,
                    });
                }
            }
            Some(Ok(Message::Close(frame))) => {
                let code = frame.as_ref().map(|f| u16::from(f.code));
                let (st, reason) = match code {
                    Some(c) => close_outcome(c),
                    None => ("DISCONNECTED", "NORMAL"),
                };
                emit(status(st, code, Some(reason)));
                return;
            }
            Some(Ok(_)) => {} // ping/pong/binary: ignored (we use the JSON mode)
            Some(Err(_)) | None => {
                emit(status("ERROR", None, Some("NETWORK")));
                return;
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Mutex;
    use tokio::net::TcpListener;
    use tokio_tungstenite::tungstenite::protocol::frame::coding::CloseCode;
    use tokio_tungstenite::tungstenite::protocol::CloseFrame;

    const CHAT: &str = r#"{"timestamp":1,"messages":[
        {"type":"roomInfo","data":{"roomId":"1"}},
        {"type":"WebcastChatMessage","data":{
            "comment":"  黑色 M 要 2 件 🔥 ",
            "user":{"uniqueId":"amy_tw","nickname":"Amy","userId":"123"},
            "common":{"msgId":"7300000000000000001","createTime":"1761800000000"}}},
        {"type":"WebcastGiftMessage","data":{}}
    ]}"#;

    #[test]
    fn parses_a_chat_bundle() {
        let f = parse_frame(CHAT);
        assert_eq!(f.comments.len(), 1);
        let c = &f.comments[0];
        assert_eq!(c.comment_text, "黑色 M 要 2 件 🔥");
        assert_eq!(c.username.as_deref(), Some("amy_tw"));
        assert_eq!(c.display_name.as_deref(), Some("Amy"));
        assert_eq!(c.event_id, "euler-7300000000000000001");
        assert_eq!(c.comment_timestamp_ms, Some(1_761_800_000_000));
        assert!(!f.connected);
    }

    #[test]
    fn single_message_connect_and_status() {
        assert!(parse_frame(r#"{"type":"tiktok.connect","data":{"agentId":"a"}}"#).connected);
        assert!(parse_frame(r#"{"type":"room.status","data":{"state":"connected"}}"#).connected);
        assert!(!parse_frame(r#"{"type":"room.status","data":{"state":"offline"}}"#).connected);
    }

    #[test]
    fn missing_id_falls_back_to_a_stable_hash_and_seconds_are_converted() {
        let a = r#"{"type":"WebcastChatMessage","data":{"comment":"hi","user":{"uniqueId":"a1"},"common":{"createTime":1761800000}}}"#;
        let f1 = parse_frame(a);
        let f2 = parse_frame(a);
        assert_eq!(f1.comments[0].event_id, f2.comments[0].event_id);
        assert!(f1.comments[0].event_id.starts_with("euler-h"));
        assert_eq!(f1.comments[0].comment_timestamp_ms, Some(1_761_800_000_000));
    }

    #[test]
    fn bad_input_is_ignored_not_fatal() {
        for t in ["", "not json", "[]", r#"{"messages":"x"}"#, r#"{"type":5}"#] {
            assert_eq!(parse_frame(t), ParsedFrame::default());
        }
        let empty = r#"{"type":"WebcastChatMessage","data":{"comment":"   "}}"#;
        assert!(parse_frame(empty).comments.is_empty());
        let long = format!(
            r#"{{"type":"WebcastChatMessage","data":{{"comment":"{}"}}}}"#,
            "啊".repeat(5000)
        );
        assert_eq!(
            parse_frame(&long).comments[0].comment_text.chars().count(),
            MAX_TEXT_CHARS
        );
    }

    #[test]
    fn close_codes_map_to_honest_statuses() {
        assert_eq!(close_outcome(4404), ("DISCONNECTED", "NOT_LIVE"));
        assert_eq!(close_outcome(4401), ("ERROR", "INVALID_AUTH"));
        assert_eq!(close_outcome(4403), ("ERROR", "NO_PERMISSION"));
        assert_eq!(close_outcome(4429), ("ERROR", "TOO_MANY_CONNECTIONS"));
        assert_eq!(close_outcome(4005), ("DISCONNECTED", "STREAM_END"));
        assert_eq!(close_outcome(4999), ("ERROR", "OTHER"));
    }

    #[test]
    fn unique_id_validation_and_url_never_leaks_unescaped() {
        assert_eq!(normalize_unique_id(" @shop_tw "), Some("shop_tw".into()));
        assert_eq!(normalize_unique_id("a"), None);
        assert_eq!(normalize_unique_id("bad id!"), None);
        let u = build_url(DEFAULT_WS_URL, "shop", "k&ey=1 2").unwrap();
        assert_eq!(
            u,
            "wss://ws.eulerstream.com/?uniqueId=shop&apiKey=k%26ey%3D1+2"
        );
        assert!(build_url("not a url", "shop", "k").is_none());
    }

    /// A local server that plays back frames, then closes with `close_code`.
    async fn serve(
        frames: Vec<String>,
        close_code: u16,
    ) -> (String, tokio::task::JoinHandle<String>) {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        let handle = tokio::spawn(async move {
            let (stream, _) = listener.accept().await.unwrap();
            let seen = std::sync::Arc::new(Mutex::new(String::new()));
            let seen2 = seen.clone();
            let mut ws = tokio_tungstenite::accept_hdr_async(
                stream,
                move |req: &tokio_tungstenite::tungstenite::handshake::server::Request,
                      resp: tokio_tungstenite::tungstenite::handshake::server::Response| {
                    *seen2.lock().unwrap() = req.uri().query().unwrap_or("").to_string();
                    Ok(resp)
                },
            )
            .await
            .unwrap();
            use futures_util::SinkExt;
            for f in frames {
                ws.send(Message::Text(f)).await.unwrap();
            }
            ws.send(Message::Close(Some(CloseFrame {
                code: CloseCode::from(close_code),
                reason: "".into(),
            })))
            .await
            .unwrap();
            while ws.next().await.is_some() {}
            let q = seen.lock().unwrap().clone();
            q
        });
        (format!("ws://{addr}"), handle)
    }

    async fn collect(base: &str) -> Vec<EulerOut> {
        let out = Mutex::new(Vec::new());
        run_connection(base, "shop_tw", "SECRET-KEY", &|o| {
            out.lock().unwrap().push(o)
        })
        .await;
        out.into_inner().unwrap()
    }

    #[tokio::test]
    async fn end_to_end_comments_then_not_live() {
        let (base, server) = serve(vec![CHAT.to_string()], 4404).await;
        let events = collect(&base).await;
        let query = server.await.unwrap();
        assert_eq!(query, "uniqueId=shop_tw&apiKey=SECRET-KEY");

        assert_eq!(events.len(), 3);
        assert!(matches!(
            events[0],
            EulerOut::Status {
                status: "CONNECTED",
                ..
            }
        ));
        assert!(matches!(&events[1], EulerOut::Comments { comments } if comments.len() == 1));
        assert!(matches!(
            events[2],
            EulerOut::Status {
                status: "DISCONNECTED",
                reason: Some("NOT_LIVE"),
                ..
            }
        ));
    }

    #[tokio::test]
    async fn never_connected_when_the_server_rejects_the_key() {
        let (base, server) = serve(vec![], 4401).await;
        let events = collect(&base).await;
        server.await.unwrap();
        assert_eq!(events.len(), 1);
        assert!(matches!(
            events[0],
            EulerOut::Status {
                status: "ERROR",
                reason: Some("INVALID_AUTH"),
                ..
            }
        ));
    }

    #[tokio::test]
    async fn unreachable_server_is_a_network_error_without_the_key() {
        let events = collect("ws://127.0.0.1:1").await;
        assert_eq!(events.len(), 1);
        let json = serde_json::to_string(&events[0]).unwrap();
        assert!(json.contains("NETWORK"));
        assert!(!json.contains("SECRET-KEY"));
    }
}
