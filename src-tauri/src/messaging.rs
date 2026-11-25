//! Telegram and WhatsApp for the AI team: the shop owner sends work from their phone and gets
//! the staff's drafts back in the same chat. Only the owner's own chat is listened to: Telegram
//! links one chat by a pairing code shown in the app; WhatsApp accepts only the owner's number.
//!
//! - Telegram: long polling (getUpdates), so nothing has to be reachable from the internet.
//! - WhatsApp (Cloud API): sending is a direct call; incoming messages need a webhook on the
//!   internet, so a small relay (repo folder `relay/whatsapp`) receives them and this app pulls
//!   them every few seconds.
//!
//! Tokens stay in the OS keychain (slots `telegram`, `whatsapp`, `whatsapp-relay`); nothing here
//! returns them to the frontend.

use crate::commands::SecretState;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager, State};

const TG_API: &str = "https://api.telegram.org";
const WA_API: &str = "https://graph.facebook.com/v21.0";
const MAX_TEXT: usize = 3_900;

#[derive(Default)]
pub struct ChatState {
    telegram: AtomicU64,
    whatsapp: AtomicU64,
}

#[derive(Serialize, Clone)]
pub struct Incoming {
    pub channel: &'static str,
    pub from: String,
    pub text: String,
}

#[derive(Serialize, Clone)]
pub struct ChatStatus {
    pub channel: &'static str,
    /// "running", "stopped" or "error".
    pub state: &'static str,
    pub code: Option<String>,
}

#[derive(Serialize, Clone)]
pub struct Paired {
    pub channel: &'static str,
    pub chat: String,
}

fn client(timeout: u64) -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .timeout(Duration::from_secs(timeout))
        .build()
        .map_err(|_| "NETWORK".to_string())
}

fn secret(app: &AppHandle, slot: &str) -> Result<String, String> {
    app.state::<SecretState>()
        .0
        .get(slot)
        .map_err(|_| "KEYCHAIN".to_string())?
        .ok_or_else(|| "NO_KEY".to_string())
}

/// Long texts go out in pieces the chat accepts, cut at line ends when possible.
pub fn split_text(text: &str) -> Vec<String> {
    let mut out = Vec::new();
    let mut cur = String::new();
    for line in text.split_inclusive('\n') {
        if cur.chars().count() + line.chars().count() > MAX_TEXT && !cur.is_empty() {
            out.push(std::mem::take(&mut cur));
        }
        if line.chars().count() > MAX_TEXT {
            let chars: Vec<char> = line.chars().collect();
            for c in chars.chunks(MAX_TEXT) {
                out.push(c.iter().collect());
            }
        } else {
            cur.push_str(line);
        }
    }
    if !cur.trim().is_empty() {
        out.push(cur);
    }
    out
}

/// The owner's WhatsApp number as the API wants it: digits only, with country code.
pub fn clean_phone(s: &str) -> Option<String> {
    let d: String = s.chars().filter(|c| c.is_ascii_digit()).collect();
    (8..=15).contains(&d.len()).then_some(d)
}

// ---------------- Telegram ----------------

#[derive(Deserialize)]
struct TgUpdates {
    ok: bool,
    #[serde(default)]
    result: Vec<TgUpdate>,
}
#[derive(Deserialize)]
struct TgUpdate {
    update_id: i64,
    message: Option<TgMessage>,
}
#[derive(Deserialize)]
struct TgMessage {
    chat: TgChat,
    text: Option<String>,
}
#[derive(Deserialize)]
struct TgChat {
    id: i64,
}

/// What one incoming Telegram message means for the app.
#[derive(Debug, PartialEq)]
pub enum TgAction {
    Task(String),
    Pair,
    Ignore,
}

pub fn tg_action(chat: i64, text: &str, owner: Option<i64>, code: Option<&str>) -> TgAction {
    let text = text.trim();
    if owner == Some(chat) {
        return if text.is_empty() {
            TgAction::Ignore
        } else {
            TgAction::Task(text.to_string())
        };
    }
    match (owner, code) {
        (None, Some(code)) if !code.is_empty() && text == format!("/start {code}") => {
            TgAction::Pair
        }
        _ => TgAction::Ignore,
    }
}

async fn tg_send(token: &str, chat: &str, text: &str) -> Result<(), String> {
    let http = client(20)?;
    for part in split_text(text) {
        let r = http
            .post(format!("{TG_API}/bot{token}/sendMessage"))
            .json(&json!({ "chat_id": chat, "text": part }))
            .send()
            .await
            .map_err(|_| "NETWORK".to_string())?;
        match r.status().as_u16() {
            200 => {}
            401 | 404 => return Err("AUTH".into()),
            403 => return Err("BLOCKED".into()),
            _ => return Err("BAD_REQUEST".into()),
        }
    }
    Ok(())
}

/// Start (or restart) listening to the bot. With `owner` set only that chat is heard; without it
/// the first chat that sends `/start <code>` becomes the owner's (the app saves it).
#[tauri::command]
pub fn chat_telegram_start(
    app: AppHandle,
    state: State<'_, ChatState>,
    owner: Option<String>,
    code: Option<String>,
) -> Result<(), String> {
    let token = secret(&app, "telegram")?;
    let owner: Option<i64> = owner.and_then(|o| o.trim().parse().ok());
    let generation = state.telegram.fetch_add(1, Ordering::SeqCst) + 1;
    tauri::async_runtime::spawn(async move {
        let http = match client(40) {
            Ok(h) => h,
            Err(_) => return,
        };
        let mut offset: i64 = 0;
        let status = |s: &'static str, code: Option<String>| {
            let _ = app.emit(
                "chat://status",
                ChatStatus {
                    channel: "telegram",
                    state: s,
                    code,
                },
            );
        };
        status("running", None);
        let alive = |app: &AppHandle| {
            app.state::<ChatState>().telegram.load(Ordering::SeqCst) == generation
        };
        while alive(&app) {
            let url = format!("{TG_API}/bot{token}/getUpdates?timeout=25&offset={offset}");
            let res = http.get(&url).send().await;
            let body = match res {
                Ok(r) if r.status().as_u16() == 401 || r.status().as_u16() == 404 => {
                    status("error", Some("AUTH".into()));
                    return;
                }
                Ok(r) => r.json::<TgUpdates>().await.ok(),
                Err(_) => None,
            };
            let Some(body) = body.filter(|b| b.ok) else {
                status("error", Some("NETWORK".into()));
                tokio::time::sleep(Duration::from_secs(5)).await;
                continue;
            };
            if !alive(&app) {
                break;
            }
            for u in body.result {
                offset = offset.max(u.update_id + 1);
                let Some(m) = u.message else { continue };
                let text = m.text.unwrap_or_default();
                match tg_action(m.chat.id, &text, owner, code.as_deref()) {
                    TgAction::Task(text) => {
                        let _ = app.emit(
                            "chat://incoming",
                            Incoming {
                                channel: "telegram",
                                from: m.chat.id.to_string(),
                                text,
                            },
                        );
                    }
                    TgAction::Pair => {
                        let _ = app.emit(
                            "chat://paired",
                            Paired {
                                channel: "telegram",
                                chat: m.chat.id.to_string(),
                            },
                        );
                    }
                    TgAction::Ignore => {}
                }
            }
        }
        status("stopped", None);
    });
    Ok(())
}

#[tauri::command]
pub fn chat_telegram_stop(state: State<'_, ChatState>) {
    state.telegram.fetch_add(1, Ordering::SeqCst);
}

// ---------------- WhatsApp ----------------

#[derive(Deserialize)]
struct RelayPull {
    #[serde(default)]
    messages: Vec<RelayMessage>,
}
#[derive(Deserialize)]
struct RelayMessage {
    from: String,
    text: String,
}

fn wa_error(status: u16, body: &Value) -> String {
    let code = body["error"]["code"].as_i64().unwrap_or(0);
    match (status, code) {
        (_, 131047) => "OUTSIDE_WINDOW".into(),
        (401, _) | (_, 190) => "AUTH".into(),
        (429, _) => "RATE_LIMIT".into(),
        _ => "BAD_REQUEST".into(),
    }
}

async fn wa_send(token: &str, phone_id: &str, to: &str, text: &str) -> Result<(), String> {
    let http = client(20)?;
    for part in split_text(text) {
        let r = http
            .post(format!("{WA_API}/{phone_id}/messages"))
            .bearer_auth(token)
            .json(&json!({
                "messaging_product": "whatsapp",
                "to": to,
                "type": "text",
                "text": { "body": part, "preview_url": false }
            }))
            .send()
            .await
            .map_err(|_| "NETWORK".to_string())?;
        let status = r.status().as_u16();
        if status != 200 {
            let body: Value = r.json().await.unwrap_or(Value::Null);
            return Err(wa_error(status, &body));
        }
    }
    Ok(())
}

/// Pull the owner's WhatsApp messages from the relay every few seconds.
#[tauri::command]
pub fn chat_whatsapp_start(
    app: AppHandle,
    state: State<'_, ChatState>,
    relay: String,
    owner: String,
) -> Result<(), String> {
    let key = secret(&app, "whatsapp-relay")?;
    let owner = clean_phone(&owner).ok_or("BAD_PHONE")?;
    let base = url::Url::parse(relay.trim()).map_err(|_| "BAD_URL".to_string())?;
    if base.scheme() != "https" {
        return Err("BAD_URL".into());
    }
    let pull = base.join("/api/pull").map_err(|_| "BAD_URL".to_string())?;
    let generation = state.whatsapp.fetch_add(1, Ordering::SeqCst) + 1;
    tauri::async_runtime::spawn(async move {
        let http = match client(20) {
            Ok(h) => h,
            Err(_) => return,
        };
        let status = |s: &'static str, code: Option<String>| {
            let _ = app.emit(
                "chat://status",
                ChatStatus {
                    channel: "whatsapp",
                    state: s,
                    code,
                },
            );
        };
        status("running", None);
        let alive = |app: &AppHandle| {
            app.state::<ChatState>().whatsapp.load(Ordering::SeqCst) == generation
        };
        while alive(&app) {
            match http.get(pull.clone()).bearer_auth(&key).send().await {
                Ok(r) if r.status().as_u16() == 401 => {
                    status("error", Some("AUTH".into()));
                    return;
                }
                Ok(r) if r.status().is_success() => {
                    if let Ok(p) = r.json::<RelayPull>().await {
                        for m in p.messages {
                            if clean_phone(&m.from).as_deref() == Some(owner.as_str())
                                && alive(&app)
                            {
                                let _ = app.emit(
                                    "chat://incoming",
                                    Incoming {
                                        channel: "whatsapp",
                                        from: owner.clone(),
                                        text: m.text,
                                    },
                                );
                            }
                        }
                    }
                }
                _ => status("error", Some("NETWORK".into())),
            }
            tokio::time::sleep(Duration::from_secs(6)).await;
        }
        status("stopped", None);
    });
    Ok(())
}

#[tauri::command]
pub fn chat_whatsapp_stop(state: State<'_, ChatState>) {
    state.whatsapp.fetch_add(1, Ordering::SeqCst);
}

/// Send a message to the owner. Telegram: `to` = the paired chat id. WhatsApp: `to` = the
/// owner's number and `phone_id` = the business number's id from Meta.
#[tauri::command]
pub async fn chat_send(
    app: AppHandle,
    channel: String,
    to: String,
    text: String,
    phone_id: Option<String>,
) -> Result<(), String> {
    if text.trim().is_empty() {
        return Ok(());
    }
    match channel.as_str() {
        "telegram" => {
            let token = secret(&app, "telegram")?;
            let chat = to.trim();
            if chat.parse::<i64>().is_err() {
                return Err("NOT_PAIRED".into());
            }
            tg_send(&token, chat, &text).await
        }
        "whatsapp" => {
            let token = secret(&app, "whatsapp")?;
            let to = clean_phone(&to).ok_or("BAD_PHONE")?;
            let id = phone_id.unwrap_or_default();
            if id.is_empty() || !id.chars().all(|c| c.is_ascii_digit()) {
                return Err("BAD_PHONE_ID".into());
            }
            wa_send(&token, &id, &to, &text).await
        }
        _ => Err("UNKNOWN_CHANNEL".into()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_the_owner_or_the_pairing_code_is_heard() {
        assert_eq!(
            tg_action(5, " tổng kết ", Some(5), None),
            TgAction::Task("tổng kết".into())
        );
        assert_eq!(
            tg_action(6, "tổng kết", Some(5), Some("123")),
            TgAction::Ignore
        );
        assert_eq!(
            tg_action(6, "/start 123", None, Some("123")),
            TgAction::Pair
        );
        assert_eq!(
            tg_action(6, "/start 999", None, Some("123")),
            TgAction::Ignore
        );
        assert_eq!(tg_action(6, "/start ", None, Some("")), TgAction::Ignore);
    }

    #[test]
    fn splits_long_texts_and_cleans_numbers() {
        let long = "a\n".repeat(3_000);
        let parts = split_text(&long);
        assert!(parts.len() >= 2 && parts.iter().all(|p| p.chars().count() <= MAX_TEXT));
        assert_eq!(parts.concat(), long);
        assert_eq!(
            clean_phone("+886 912-345-678").as_deref(),
            Some("886912345678")
        );
        assert_eq!(clean_phone("123"), None);
    }

    #[test]
    fn whatsapp_errors_are_short_codes() {
        let outside = json!({"error": {"code": 131047}});
        assert_eq!(wa_error(400, &outside), "OUTSIDE_WINDOW");
        assert_eq!(wa_error(401, &Value::Null), "AUTH");
    }
}
