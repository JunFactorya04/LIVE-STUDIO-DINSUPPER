//! Multi-platform ad reporting and basic campaign control (seller's own accounts, BYOK).
//!
//! Scope, deliberately: read spend/impressions/clicks/conversions for the last 7 days, list
//! campaigns, and pause/enable an existing campaign. Creating a new campaign (budget, targeting,
//! creative) is NOT implemented — that needs careful per-platform review before any money moves,
//! and is out of scope for this pass. Every call uses the seller's own access token/developer
//! token, read from the OS keychain; nothing here ever logs or returns a token.
//!
//! None of this has been exercised against a real ad account (no test credentials were
//! available while writing it) — it follows each platform's own documented REST contract as
//! closely as possible, but the seller should verify carefully, with a small budget, before
//! trusting the pause/enable button on a live campaign.

mod google;
mod meta;
mod tiktok;

use crate::secrets::SecretStore;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Platform {
    Tiktok,
    Meta,
    Google,
}

impl Platform {
    fn slot_name(self) -> &'static str {
        match self {
            Platform::Tiktok => "tiktok",
            Platform::Meta => "meta",
            Platform::Google => "google",
        }
    }

    pub fn parse(s: &str) -> Result<Platform, String> {
        match s {
            "tiktok" => Ok(Platform::Tiktok),
            "meta" => Ok(Platform::Meta),
            "google" => Ok(Platform::Google),
            _ => Err("UNKNOWN_PLATFORM".into()),
        }
    }
}

/// Reads `ads-<platform>-<field>` (field already lower-case, matching the slot convention).
fn secret(store: &dyn SecretStore, platform: Platform, field: &str) -> Result<String, String> {
    let slot = format!("ads-{}-{field}", platform.slot_name());
    store
        .get(&slot)?
        .map(|v| v.trim().to_string())
        .filter(|v| !v.is_empty())
        .ok_or_else(|| "NO_CREDENTIALS".to_string())
}

#[derive(Debug, Clone, Default, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AdStats {
    pub spend: f64,
    pub impressions: u64,
    pub clicks: u64,
    pub conversions: u64,
    /// ISO 4217, best-effort (the account's own reporting currency).
    pub currency: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum CampaignStatus {
    Enabled,
    Paused,
    /// Anything the platform reports that isn't a simple on/off (e.g. under review, archived).
    Other,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AdCampaign {
    pub id: String,
    pub name: String,
    pub status: CampaignStatus,
    /// The account's own currency, smallest-unit-free (a plain amount), when the platform gives one.
    pub daily_budget: Option<f64>,
}

/// Short, stable codes the UI translates. Never includes the token or the platform's raw body.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AdsError {
    NotConfigured,
    Auth,
    RateLimit,
    Network,
    Api,
}

impl AdsError {
    pub fn code(self) -> &'static str {
        match self {
            AdsError::NotConfigured => "NOT_CONFIGURED",
            AdsError::Auth => "AUTH",
            AdsError::RateLimit => "RATE_LIMIT",
            AdsError::Network => "NETWORK",
            AdsError::Api => "API_ERROR",
        }
    }
}

impl From<AdsError> for String {
    fn from(e: AdsError) -> String {
        e.code().to_string()
    }
}

/// Civil (proleptic Gregorian) date from a day count since the Unix epoch. Same algorithm as
/// `ecpay::civil`, duplicated here rather than shared across two unrelated integrations.
fn civil(z: i64) -> (i64, i64, i64) {
    let z = z + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z.rem_euclid(146_097);
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    (if m <= 2 { y + 1 } else { y }, m, d)
}

/// `(start, end)` as `YYYY-MM-DD` (UTC), covering today and the `n - 1` days before it.
pub(crate) fn last_n_days(n: i64) -> (String, String) {
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0);
    let fmt = |secs: i64| {
        let (y, m, d) = civil(secs.div_euclid(86400));
        format!("{y:04}-{m:02}-{d:02}")
    };
    (fmt(now - (n - 1) * 86400), fmt(now))
}

fn map_creds_err(e: String) -> AdsError {
    if e == "NO_CREDENTIALS" {
        AdsError::NotConfigured
    } else {
        AdsError::Api
    }
}

pub async fn fetch_stats(store: &dyn SecretStore, platform: Platform) -> Result<AdStats, String> {
    let r = match platform {
        Platform::Tiktok => tiktok::fetch_stats(store).await,
        Platform::Meta => meta::fetch_stats(store).await,
        Platform::Google => google::fetch_stats(store).await,
    };
    r.map_err(String::from)
}

pub async fn fetch_campaigns(
    store: &dyn SecretStore,
    platform: Platform,
) -> Result<Vec<AdCampaign>, String> {
    let r = match platform {
        Platform::Tiktok => tiktok::fetch_campaigns(store).await,
        Platform::Meta => meta::fetch_campaigns(store).await,
        Platform::Google => google::fetch_campaigns(store).await,
    };
    r.map_err(String::from)
}

pub async fn set_campaign_status(
    store: &dyn SecretStore,
    platform: Platform,
    campaign_id: &str,
    enabled: bool,
) -> Result<(), String> {
    let r = match platform {
        Platform::Tiktok => tiktok::set_campaign_status(store, campaign_id, enabled).await,
        Platform::Meta => meta::set_campaign_status(store, campaign_id, enabled).await,
        Platform::Google => google::set_campaign_status(store, campaign_id, enabled).await,
    };
    r.map_err(String::from)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn platform_parses_known_ids_only() {
        assert_eq!(Platform::parse("tiktok"), Ok(Platform::Tiktok));
        assert_eq!(Platform::parse("meta"), Ok(Platform::Meta));
        assert_eq!(Platform::parse("google"), Ok(Platform::Google));
        assert!(Platform::parse("twitter").is_err());
    }

    #[test]
    fn secret_reads_the_ads_prefixed_slot() {
        let s = crate::secrets::MemoryStore::default();
        assert_eq!(
            secret(&s, Platform::Tiktok, "accesstoken"),
            Err("NO_CREDENTIALS".to_string())
        );
        crate::secrets::set_secret(&s, "ads-tiktok-accesstoken", "tok").unwrap();
        assert_eq!(
            secret(&s, Platform::Tiktok, "accesstoken"),
            Ok("tok".into())
        );
    }
}
