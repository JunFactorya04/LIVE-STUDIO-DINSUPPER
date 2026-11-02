import { useCallback, useEffect, useState } from "react";
import { EmptyState } from "../components/States";
import {
  ADS_ERROR_CODES,
  createAdsClient,
  type AdCampaign,
  type AdsClient,
  type AdsErrorCode,
  type AdStats,
} from "../ads/client";
import { suggestAdCopy } from "../ads/adCopy";
import {
  AD_PLATFORMS,
  SECRET_FIELDS,
  slotFor,
  statusOf,
  type AdField,
  type AdPlatform,
  type AdPlatformId,
} from "../ads/registry";
import { useI18n } from "../i18n";
import { createSecretsClient, type SecretsClient } from "../secrets/client";

// Quảng cáo: the seller's own TikTok/Meta/Google ad accounts (BYOK, official advertiser APIs —
// not the Live comment source). Scope, deliberately: read spend/impressions/clicks/conversions,
// list campaigns, pause/enable one that already exists. Creating a brand-new campaign (budget,
// targeting, creative) is not implemented — see docs/ADS_SETUP.md.

function isAdsErrorCode(x: unknown): x is AdsErrorCode {
  return typeof x === "string" && (ADS_ERROR_CODES as readonly string[]).includes(x);
}

export function AdsPage() {
  const { t, locale } = useI18n();
  const a = t.ads;
  const [secrets] = useState(() => createSecretsClient());
  const [ads] = useState(() => createAdsClient());
  const [stats, setStats] = useState<Partial<Record<AdPlatformId, AdStats>>>({});
  const [open, setOpen] = useState<AdPlatformId>();

  const verifiedPlatforms = Object.keys(stats) as AdPlatformId[];
  const totals = verifiedPlatforms.reduce(
    (sum, p) => {
      const s = stats[p];
      if (!s) return sum;
      return {
        spend: sum.spend + s.spend,
        impressions: sum.impressions + s.impressions,
        clicks: sum.clicks + s.clicks,
        conversions: sum.conversions + s.conversions,
      };
    },
    { spend: 0, impressions: 0, clicks: 0, conversions: 0 },
  );

  return (
    <div className="page page--no-inspector">
      <section className="box">
        <p className="banner banner--info" role="note">
          {a.notice}
        </p>
        {!secrets.available ? (
          <EmptyState title={t.carriers.desktopOnly} hint="" />
        ) : verifiedPlatforms.length === 0 ? (
          <EmptyState title={a.emptyTitle} hint={a.emptyHint} />
        ) : (
          <div className="kpi-grid" aria-label={a.kpiTitle}>
            <div className="kpi">
              <span className="kpi__label">{a.kpi.spend}</span>
              <span className="kpi__value">{totals.spend.toFixed(2)}</span>
            </div>
            <div className="kpi">
              <span className="kpi__label">{a.kpi.impressions}</span>
              <span className="kpi__value">{totals.impressions}</span>
            </div>
            <div className="kpi">
              <span className="kpi__label">{a.kpi.clicks}</span>
              <span className="kpi__value">{totals.clicks}</span>
            </div>
            <div className="kpi">
              <span className="kpi__label">{a.kpi.conversions}</span>
              <span className="kpi__value">{totals.conversions}</span>
            </div>
          </div>
        )}
      </section>

      <div className="carrier-grid">
        {AD_PLATFORMS.map((p) => (
          <PlatformCard
            key={p.id}
            platform={p}
            locale={locale}
            secrets={secrets}
            ads={ads}
            open={open === p.id}
            onToggleOpen={() => setOpen(open === p.id ? undefined : p.id)}
            stats={stats[p.id]}
            onStats={(v) => setStats((prev) => ({ ...prev, [p.id]: v }))}
            onClearStats={() =>
              setStats((prev) => {
                const next = { ...prev };
                delete next[p.id];
                return next;
              })
            }
          />
        ))}
      </div>
      <p className="caption">{a.note}</p>
    </div>
  );
}

function PlatformCard({
  platform: p,
  locale,
  secrets,
  ads,
  open,
  onToggleOpen,
  stats,
  onStats,
  onClearStats,
}: {
  platform: AdPlatform;
  locale: string;
  secrets: SecretsClient;
  ads: AdsClient;
  open: boolean;
  onToggleOpen: () => void;
  stats: AdStats | undefined;
  onStats: (s: AdStats) => void;
  onClearStats: () => void;
}) {
  const { t } = useI18n();
  const a = t.ads;
  const [filled, setFilled] = useState<Set<AdField>>(new Set());
  const [checking, setChecking] = useState(false);
  const [checkError, setCheckError] = useState<AdsErrorCode>();
  const [campaigns, setCampaigns] = useState<AdCampaign[]>();
  const [campaignBusy, setCampaignBusy] = useState<string>();

  const refresh = useCallback(async () => {
    if (!secrets.available) return;
    const next = new Set<AdField>();
    for (const f of p.fields) {
      try {
        if (await secrets.exists(slotFor(p.id, f))) next.add(f);
      } catch {
        // unreadable slot counts as empty
      }
    }
    setFilled(next);
  }, [secrets, p]);
  useEffect(() => {
    void refresh();
  }, [refresh]);

  const status = statusOf(p, filled, Boolean(stats));

  const check = async () => {
    setChecking(true);
    setCheckError(undefined);
    try {
      const s = await ads.stats(p.id);
      onStats(s);
    } catch (e) {
      onClearStats();
      setCheckError(
        isAdsErrorCode((e as { code?: unknown }).code)
          ? (e as { code: AdsErrorCode }).code
          : "NETWORK",
      );
    } finally {
      setChecking(false);
    }
  };

  const loadCampaigns = async () => {
    try {
      setCampaigns(await ads.campaigns(p.id));
    } catch {
      setCampaigns([]);
    }
  };

  const openConsole = async () => {
    try {
      const { invoke } = await import("../platform/backend");
      await invoke("open_carrier_page", { url: p.consoleUrl });
    } catch {
      // the button is a convenience; nothing else to show if it fails to open
    }
  };

  const toggleCampaign = async (c: AdCampaign) => {
    setCampaignBusy(c.id);
    try {
      await ads.setCampaignStatus(p.id, c.id, c.status !== "ENABLED");
      await loadCampaigns();
    } catch {
      // the row's own status chip stays as last known; nothing else to show here
    } finally {
      setCampaignBusy(undefined);
    }
  };

  return (
    <article className="carrier">
      <div className="carrier__head">
        <span className={`carrier__mark tone-${p.tone}`} aria-hidden="true">
          {p.mark}
        </span>
        <div className="carrier__name">
          <strong>{locale === "vi" ? p.vi : p.zh}</strong>
        </div>
        <span
          className={`chip ${
            status === "verified" || status === "saved"
              ? "tone-green"
              : status === "partial"
                ? "tone-orange"
                : "tone-gray"
          }`}
        >
          {a.status[status]}
        </span>
      </div>

      <div className="carrier__actions">
        <button type="button" className="btn btn--primary" onClick={onToggleOpen}>
          {open ? t.carriers.close : t.carriers.connect}
        </button>
        <button
          type="button"
          className="btn"
          disabled={!secrets.available || checking}
          onClick={() => void check()}
        >
          {checking ? a.checking : a.check}
        </button>
        <button type="button" className="btn" onClick={() => void openConsole()}>
          {a.openConsole}
        </button>
      </div>

      {checkError && (
        <p className="note note--error" role="alert">
          {a.errors[checkError]}
        </p>
      )}

      {stats && (
        <dl className="kv ads__stats">
          <dt>{a.kpi.spend}</dt>
          <dd>{stats.spend.toFixed(2)}</dd>
          <dt>{a.kpi.impressions}</dt>
          <dd>{stats.impressions}</dd>
          <dt>{a.kpi.clicks}</dt>
          <dd>{stats.clicks}</dd>
          <dt>{a.kpi.conversions}</dt>
          <dd>{stats.conversions}</dd>
        </dl>
      )}

      {stats && (
        <div className="carrier__actions">
          <button type="button" className="btn" onClick={() => void loadCampaigns()}>
            {a.viewCampaigns}
          </button>
        </div>
      )}

      {campaigns && (
        <div className="ads__campaigns">
          {campaigns.length === 0 ? (
            <p className="caption">{a.noCampaigns}</p>
          ) : (
            <table className="table" aria-label={a.viewCampaigns}>
              <thead>
                <tr>
                  <th scope="col">{a.columns.name}</th>
                  <th scope="col">{a.columns.status}</th>
                  <th scope="col">{a.columns.budget}</th>
                  <th scope="col">{a.columns.actions}</th>
                </tr>
              </thead>
              <tbody>
                {campaigns.map((c) => (
                  <tr key={c.id}>
                    <td className="wrap">{c.name}</td>
                    <td>
                      <span
                        className={`chip ${c.status === "ENABLED" ? "tone-green" : "tone-gray"}`}
                      >
                        {a.campaignStatus[c.status]}
                      </span>
                    </td>
                    <td className="num">{c.dailyBudget?.toFixed(2) ?? t.common.none}</td>
                    <td>
                      <button
                        type="button"
                        className="btn"
                        disabled={campaignBusy === c.id}
                        onClick={() => void toggleCampaign(c)}
                      >
                        {c.status === "ENABLED" ? a.pause : a.enable}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {open && (
        <CredentialForm platform={p} secrets={secrets} filled={filled} onChanged={refresh} />
      )}

      <AdCopyPanel platform={p.id} />
    </article>
  );
}

function CredentialForm({
  platform: p,
  secrets,
  filled,
  onChanged,
}: {
  platform: AdPlatform;
  secrets: SecretsClient;
  filled: Set<AdField>;
  onChanged: () => void;
}) {
  const { t } = useI18n();
  const a = t.ads;
  const [values, setValues] = useState<Partial<Record<AdField, string>>>({});
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ text: string; error: boolean }>();

  const save = async () => {
    setBusy(true);
    setMsg(undefined);
    try {
      for (const f of p.fields) {
        const v = values[f]?.trim();
        if (v) await secrets.set(slotFor(p.id, f), v);
      }
      setValues({});
      setMsg({ text: a.saved, error: false });
      onChanged();
    } catch {
      setMsg({ text: a.saveFail, error: true });
    } finally {
      setBusy(false);
    }
  };
  const clear = async () => {
    setBusy(true);
    try {
      for (const f of p.fields) await secrets.remove(slotFor(p.id, f));
      setMsg({ text: a.removed, error: false });
      onChanged();
    } catch {
      setMsg({ text: a.saveFail, error: true });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="carrier__form">
      {p.fields.map((f) => (
        <label key={f} className="field">
          {a.fields[f]} {filled.has(f) && <span className="chip tone-green">{a.fieldSet}</span>}
          <input
            className="input"
            type={SECRET_FIELDS.has(f) ? "password" : "text"}
            autoComplete="off"
            spellCheck={false}
            placeholder={filled.has(f) ? a.replaceHint : ""}
            value={values[f] ?? ""}
            onChange={(e) => setValues((prev) => ({ ...prev, [f]: e.target.value }))}
          />
        </label>
      ))}
      {msg && (
        <p
          className={`note${msg.error ? " note--error" : ""}`}
          role={msg.error ? "alert" : "status"}
        >
          {msg.text}
        </p>
      )}
      <div className="actions">
        <button
          type="button"
          className="btn btn--primary"
          disabled={busy}
          onClick={() => void save()}
        >
          {a.save}
        </button>
        {filled.size > 0 && (
          <button type="button" className="btn" disabled={busy} onClick={() => void clear()}>
            {a.clear}
          </button>
        )}
      </div>
    </div>
  );
}

function AdCopyPanel({ platform }: { platform: AdPlatformId }) {
  const { t } = useI18n();
  const a = t.ads;
  const [brief, setBrief] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ headline: string; description: string }>();
  const [error, setError] = useState<string>();

  const run = async () => {
    if (!brief.trim()) return;
    setBusy(true);
    setError(undefined);
    setResult(undefined);
    try {
      setResult(await suggestAdCopy({ platform, brief: brief.trim() }));
    } catch (e) {
      setError(e instanceof Error && e.message === "NO_PROVIDER" ? a.noAiProvider : a.aiError);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="ads__copy">
      <p className="caption">{a.copyHelp}</p>
      <div className="field">
        <input
          className="input"
          type="text"
          placeholder={a.copyBriefPlaceholder}
          value={brief}
          onChange={(e) => setBrief(e.target.value)}
        />
      </div>
      <div className="actions">
        <button
          type="button"
          className="btn"
          disabled={busy || !brief.trim()}
          onClick={() => void run()}
        >
          {busy ? a.copyBusy : a.copySuggest}
        </button>
      </div>
      {error && (
        <p className="note note--error" role="alert">
          {error}
        </p>
      )}
      {result && (
        <div className="ads__copy-result">
          <p>
            <strong>{a.copyHeadline}:</strong> {result.headline}
          </p>
          <p>
            <strong>{a.copyDescription}:</strong> {result.description}
          </p>
        </div>
      )}
    </div>
  );
}
