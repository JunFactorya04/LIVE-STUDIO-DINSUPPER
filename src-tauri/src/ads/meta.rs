//! Meta (Facebook/Instagram) Marketing API — official advertiser API, Graph API v19.0.
//! Docs: <https://developers.facebook.com/docs/marketing-api/insights>,
//! <https://developers.facebook.com/docs/marketing-api/reference/ad-campaign-group>.
//! "Conversions" here is a simplified sum of every `actions` entry the insights call returns,
//! since which action type counts as "a conversion" is a choice the seller makes per campaign
//! (purchase, lead, etc.) — a future pass could let them pick the action type instead of summing.

use super::{secret, AdCampaign, AdStats, AdsError, CampaignStatus, Platform};
use crate::secrets::SecretStore;
use serde_json::Value;
use std::time::Duration;

const BASE: &str = "https://graph.facebook.com/v19.0";

struct Creds {
    access_token: String,
    /// The user pastes either the bare numeric id or the `act_<id>` form; we normalize it.
    ad_account_id: String,
}

fn load_creds(store: &dyn SecretStore) -> Result<Creds, AdsError> {
    let raw = secret(store, Platform::Meta, "adaccountid").map_err(super::map_creds_err)?;
    let ad_account_id = if raw.starts_with("act_") {
        raw
    } else {
        format!("act_{raw}")
    };
    Ok(Creds {
        access_token: secret(store, Platform::Meta, "accesstoken").map_err(super::map_creds_err)?,
        ad_account_id,
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
    let cl = client()?;
    let resp = cl
        .get(format!("{BASE}/{}/insights", c.ad_account_id))
        .query(&[
            ("fields", "spend,impressions,clicks,actions"),
            ("date_preset", "last_7d"),
            ("access_token", c.access_token.as_str()),
        ])
        .send()
        .await
        .map_err(|_| AdsError::Network)?;
    if let Some(e) = status_code(resp.status()) {
        return Err(e);
    }
    let body: Value = resp.json().await.map_err(|_| AdsError::Api)?;
    if body.get("error").is_some() {
        return Err(AdsError::Api);
    }
    let row = body.pointer("/data/0").cloned().unwrap_or(Value::Null);
    let num_str = |k: &str| -> f64 {
        row.get(k)
            .and_then(Value::as_str)
            .and_then(|s| s.parse().ok())
            .unwrap_or(0.0)
    };
    let conversions: f64 = row
        .get("actions")
        .and_then(Value::as_array)
        .map(|a| {
            a.iter()
                .filter_map(|x| x.get("value").and_then(Value::as_str))
                .filter_map(|v| v.parse::<f64>().ok())
                .sum()
        })
        .unwrap_or(0.0);
    Ok(AdStats {
        spend: num_str("spend"),
        impressions: num_str("impressions") as u64,
        clicks: num_str("clicks") as u64,
        conversions: conversions as u64,
        currency: "".into(), // not part of the insights payload requested above
    })
}

pub async fn fetch_campaigns(store: &dyn SecretStore) -> Result<Vec<AdCampaign>, AdsError> {
    let c = load_creds(store)?;
    let cl = client()?;
    let resp = cl
        .get(format!("{BASE}/{}/campaigns", c.ad_account_id))
        .query(&[
            ("fields", "id,name,status,daily_budget"),
            ("access_token", c.access_token.as_str()),
        ])
        .send()
        .await
        .map_err(|_| AdsError::Network)?;
    if let Some(e) = status_code(resp.status()) {
        return Err(e);
    }
    let body: Value = resp.json().await.map_err(|_| AdsError::Api)?;
    if body.get("error").is_some() {
        return Err(AdsError::Api);
    }
    let list = body
        .get("data")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    Ok(list
        .iter()
        .map(|c| AdCampaign {
            id: c
                .get("id")
                .and_then(Value::as_str)
                .unwrap_or_default()
                .to_string(),
            name: c
                .get("name")
                .and_then(Value::as_str)
                .unwrap_or_default()
                .to_string(),
            status: match c.get("status").and_then(Value::as_str) {
                Some("ACTIVE") => CampaignStatus::Enabled,
                Some("PAUSED") => CampaignStatus::Paused,
                _ => CampaignStatus::Other,
            },
            // Meta reports budgets in the account's smallest currency unit (cents for most
            // currencies); divide by 100 as a reasonable default for display.
            daily_budget: c
                .get("daily_budget")
                .and_then(Value::as_str)
                .and_then(|s| s.parse::<f64>().ok())
                .map(|v| v / 100.0),
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
        .post(format!("{BASE}/{campaign_id}"))
        .query(&[
            ("status", if enabled { "ACTIVE" } else { "PAUSED" }),
            ("access_token", c.access_token.as_str()),
        ])
        .send()
        .await
        .map_err(|_| AdsError::Network)?;
    if let Some(e) = status_code(resp.status()) {
        return Err(e);
    }
    let body: Value = resp.json().await.map_err(|_| AdsError::Api)?;
    if body.get("error").is_some() {
        return Err(AdsError::Api);
    }
    Ok(())
}
