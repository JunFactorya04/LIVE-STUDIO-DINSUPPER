//! TikTok for Business Marketing API (official advertiser API — not Euler Stream, not the
//! consumer TikTok app; needs its own developer app + an ad account the seller owns).
//! Docs: <https://business-api.tiktok.com/portal/docs> (Reporting, Campaign endpoints, v1.3).

use super::{secret, AdCampaign, AdStats, AdsError, CampaignStatus, Platform};
use crate::secrets::SecretStore;
use serde_json::{json, Value};
use std::time::Duration;

const BASE: &str = "https://business-api.tiktok.com/open_api/v1.3";

struct Creds {
    access_token: String,
    advertiser_id: String,
}

fn load_creds(store: &dyn SecretStore) -> Result<Creds, AdsError> {
    Ok(Creds {
        access_token: secret(store, Platform::Tiktok, "accesstoken")
            .map_err(super::map_creds_err)?,
        advertiser_id: secret(store, Platform::Tiktok, "advertiserid")
            .map_err(super::map_creds_err)?,
    })
}

fn client() -> Result<reqwest::Client, AdsError> {
    reqwest::Client::builder()
        .timeout(Duration::from_secs(20))
        .build()
        .map_err(|_| AdsError::Network)
}

fn status_code(resp_status: reqwest::StatusCode) -> Option<AdsError> {
    if resp_status.as_u16() == 401 || resp_status.as_u16() == 403 {
        Some(AdsError::Auth)
    } else if resp_status.as_u16() == 429 {
        Some(AdsError::RateLimit)
    } else if !resp_status.is_success() {
        Some(AdsError::Api)
    } else {
        None
    }
}

pub async fn fetch_stats(store: &dyn SecretStore) -> Result<AdStats, AdsError> {
    let c = load_creds(store)?;
    let (start, end) = super::last_n_days(7);
    let cl = client()?;
    let resp = cl
        .get(format!("{BASE}/report/integrated/get/"))
        .header("Access-Token", &c.access_token)
        .query(&[
            ("advertiser_id", c.advertiser_id.as_str()),
            ("report_type", "BASIC"),
            ("data_level", "AUCTION_ADVERTISER"),
            ("dimensions", "[\"advertiser_id\"]"),
            (
                "metrics",
                "[\"spend\",\"impressions\",\"clicks\",\"conversion\"]",
            ),
            ("start_date", &start),
            ("end_date", &end),
            ("page", "1"),
            ("page_size", "10"),
        ])
        .send()
        .await
        .map_err(|_| AdsError::Network)?;
    if let Some(e) = status_code(resp.status()) {
        return Err(e);
    }
    let body: Value = resp.json().await.map_err(|_| AdsError::Api)?;
    if body.get("code").and_then(Value::as_i64) != Some(0) {
        return Err(AdsError::Api);
    }
    let row = body
        .pointer("/data/list/0/metrics")
        .cloned()
        .unwrap_or(Value::Null);
    let num = |k: &str| -> f64 {
        row.get(k)
            .and_then(|v| v.as_str().and_then(|s| s.parse().ok()).or(v.as_f64()))
            .unwrap_or(0.0)
    };
    Ok(AdStats {
        spend: num("spend"),
        impressions: num("impressions") as u64,
        clicks: num("clicks") as u64,
        conversions: num("conversion") as u64,
        currency: "".into(), // TikTok reports in the advertiser account's own currency; not in this payload.
    })
}

pub async fn fetch_campaigns(store: &dyn SecretStore) -> Result<Vec<AdCampaign>, AdsError> {
    let c = load_creds(store)?;
    let cl = client()?;
    let resp = cl
        .get(format!("{BASE}/campaign/get/"))
        .header("Access-Token", &c.access_token)
        .query(&[
            ("advertiser_id", c.advertiser_id.as_str()),
            ("page", "1"),
            ("page_size", "50"),
        ])
        .send()
        .await
        .map_err(|_| AdsError::Network)?;
    if let Some(e) = status_code(resp.status()) {
        return Err(e);
    }
    let body: Value = resp.json().await.map_err(|_| AdsError::Api)?;
    if body.get("code").and_then(Value::as_i64) != Some(0) {
        return Err(AdsError::Api);
    }
    let list = body
        .pointer("/data/list")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    Ok(list
        .iter()
        .map(|c| AdCampaign {
            id: c
                .get("campaign_id")
                .and_then(Value::as_str)
                .unwrap_or_default()
                .to_string(),
            name: c
                .get("campaign_name")
                .and_then(Value::as_str)
                .unwrap_or_default()
                .to_string(),
            status: match c.get("status").and_then(Value::as_str) {
                Some("CAMPAIGN_STATUS_ENABLE") => CampaignStatus::Enabled,
                Some("CAMPAIGN_STATUS_DISABLE") => CampaignStatus::Paused,
                _ => CampaignStatus::Other,
            },
            daily_budget: c.get("budget").and_then(Value::as_f64),
        })
        .collect())
}

pub async fn set_campaign_status(
    store: &dyn SecretStore,
    campaign_id: &str,
    enabled: bool,
) -> Result<(), AdsError> {
    let c = load_creds(store)?;
    let cl = client()?;
    let resp = cl
        .post(format!("{BASE}/campaign/update/status/"))
        .header("Access-Token", &c.access_token)
        .json(&json!({
            "advertiser_id": c.advertiser_id,
            "campaign_ids": [campaign_id],
            "operation_status": if enabled { "ENABLE" } else { "DISABLE" },
        }))
        .send()
        .await
        .map_err(|_| AdsError::Network)?;
    if let Some(e) = status_code(resp.status()) {
        return Err(e);
    }
    let body: Value = resp.json().await.map_err(|_| AdsError::Api)?;
    if body.get("code").and_then(Value::as_i64) != Some(0) {
        return Err(AdsError::Api);
    }
    Ok(())
}
