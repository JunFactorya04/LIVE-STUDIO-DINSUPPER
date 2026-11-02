//! Google Ads API — official advertiser API (needs a developer token approved by Google plus an
//! OAuth app the seller registers themselves; see docs/ADS_SETUP.md). The seller supplies a
//! long-lived refresh token (obtained once through Google's own OAuth consent flow, outside this
//! app); every call here exchanges it for a short-lived access token first.
//! Docs: <https://developers.google.com/google-ads/api/docs/start> (REST, GAQL `search`).

use super::{secret, AdCampaign, AdStats, AdsError, CampaignStatus, Platform};
use crate::secrets::SecretStore;
use serde_json::{json, Value};
use std::time::Duration;

const API_VERSION: &str = "v17";
const TOKEN_URL: &str = "https://oauth2.googleapis.com/token";

struct Creds {
    developer_token: String,
    client_id: String,
    client_secret: String,
    refresh_token: String,
    customer_id: String,
}

fn load_creds(store: &dyn SecretStore) -> Result<Creds, AdsError> {
    let digits_only = |s: String| s.chars().filter(char::is_ascii_digit).collect::<String>();
    Ok(Creds {
        developer_token: secret(store, Platform::Google, "developertoken")
            .map_err(super::map_creds_err)?,
        client_id: secret(store, Platform::Google, "clientid").map_err(super::map_creds_err)?,
        client_secret: secret(store, Platform::Google, "clientsecret")
            .map_err(super::map_creds_err)?,
        refresh_token: secret(store, Platform::Google, "refreshtoken")
            .map_err(super::map_creds_err)?,
        customer_id: digits_only(
            secret(store, Platform::Google, "customerid").map_err(super::map_creds_err)?,
        ),
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

/// Exchanges the stored refresh token for a short-lived access token. Called fresh for every
/// report/mutate call rather than cached, since this module has no place to keep a short-lived
/// in-memory cache across Tauri command invocations without adding app-wide state.
async fn access_token(cl: &reqwest::Client, c: &Creds) -> Result<String, AdsError> {
    let resp = cl
        .post(TOKEN_URL)
        .form(&[
            ("client_id", c.client_id.as_str()),
            ("client_secret", c.client_secret.as_str()),
            ("refresh_token", c.refresh_token.as_str()),
            ("grant_type", "refresh_token"),
        ])
        .send()
        .await
        .map_err(|_| AdsError::Network)?;
    if let Some(e) = status_code(resp.status()) {
        return Err(e);
    }
    let body: Value = resp.json().await.map_err(|_| AdsError::Api)?;
    body.get("access_token")
        .and_then(Value::as_str)
        .map(str::to_string)
        .ok_or(AdsError::Auth)
}

async fn search(
    cl: &reqwest::Client,
    c: &Creds,
    token: &str,
    query: &str,
) -> Result<Vec<Value>, AdsError> {
    let resp = cl
        .post(format!(
            "https://googleads.googleapis.com/{API_VERSION}/customers/{}/googleAds:search",
            c.customer_id
        ))
        .bearer_auth(token)
        .header("developer-token", &c.developer_token)
        .json(&json!({ "query": query }))
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
    Ok(body
        .get("results")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default())
}

pub async fn fetch_stats(store: &dyn SecretStore) -> Result<AdStats, AdsError> {
    let c = load_creds(store)?;
    let cl = client()?;
    let token = access_token(&cl, &c).await?;
    let rows = search(
        &cl,
        &c,
        &token,
        "SELECT metrics.cost_micros, metrics.impressions, metrics.clicks, metrics.conversions \
         FROM customer WHERE segments.date DURING LAST_7_DAYS",
    )
    .await?;
    let num = |row: &Value, path: &str| -> f64 {
        row.pointer(path)
            .and_then(|v| {
                v.as_f64()
                    .or_else(|| v.as_str().and_then(|s| s.parse().ok()))
            })
            .unwrap_or(0.0)
    };
    let mut spend_micros = 0.0;
    let mut impressions = 0u64;
    let mut clicks = 0u64;
    let mut conversions = 0u64;
    for row in &rows {
        spend_micros += num(row, "/metrics/costMicros");
        impressions += num(row, "/metrics/impressions") as u64;
        clicks += num(row, "/metrics/clicks") as u64;
        conversions += num(row, "/metrics/conversions") as u64;
    }
    Ok(AdStats {
        spend: spend_micros / 1_000_000.0,
        impressions,
        clicks,
        conversions,
        currency: "".into(), // the account's currency code needs a separate customer lookup
    })
}

pub async fn fetch_campaigns(store: &dyn SecretStore) -> Result<Vec<AdCampaign>, AdsError> {
    let c = load_creds(store)?;
    let cl = client()?;
    let token = access_token(&cl, &c).await?;
    let rows = search(
        &cl,
        &c,
        &token,
        "SELECT campaign.id, campaign.name, campaign.status, campaign_budget.amount_micros \
         FROM campaign WHERE campaign.status != 'REMOVED'",
    )
    .await?;
    Ok(rows
        .iter()
        .map(|row| AdCampaign {
            id: row
                .pointer("/campaign/id")
                .map(|v| {
                    v.as_str()
                        .map(str::to_string)
                        .unwrap_or_else(|| v.to_string())
                })
                .unwrap_or_default(),
            name: row
                .pointer("/campaign/name")
                .and_then(Value::as_str)
                .unwrap_or_default()
                .to_string(),
            status: match row.pointer("/campaign/status").and_then(Value::as_str) {
                Some("ENABLED") => CampaignStatus::Enabled,
                Some("PAUSED") => CampaignStatus::Paused,
                _ => CampaignStatus::Other,
            },
            daily_budget: row
                .pointer("/campaignBudget/amountMicros")
                .and_then(|v| {
                    v.as_f64()
                        .or_else(|| v.as_str().and_then(|s| s.parse().ok()))
                })
                .map(|v| v / 1_000_000.0),
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
    let token = access_token(&cl, &c).await?;
    let resource = format!("customers/{}/campaigns/{campaign_id}", c.customer_id);
    let resp = cl
        .post(format!(
            "https://googleads.googleapis.com/{API_VERSION}/customers/{}/campaigns:mutate",
            c.customer_id
        ))
        .bearer_auth(&token)
        .header("developer-token", &c.developer_token)
        .json(&json!({
            "operations": [{
                "update": {
                    "resourceName": resource,
                    "status": if enabled { "ENABLED" } else { "PAUSED" },
                },
                "updateMask": "status",
            }]
        }))
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
