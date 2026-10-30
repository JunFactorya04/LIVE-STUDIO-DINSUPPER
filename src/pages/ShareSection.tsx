import { useEffect, useMemo, useState } from "react";
import qrcode from "qrcode-generator";
import { useI18n } from "../i18n";
import { createShareClient, NOT_SHARING, type ShareClient, type ShareInfo } from "../share/client";
import { setSharing } from "../share/sharing";

// Turns the phone link on and off and shows it as a QR code. Off by default and off again when
// the app closes. The link carries a secret that changes at every start.

function Qr({ text, label }: { text: string; label: string }) {
  const svg = useMemo(() => {
    const q = qrcode(0, "M");
    q.addData(text);
    q.make();
    return q.createSvgTag({ cellSize: 4, margin: 2, scalable: true });
  }, [text]);
  return (
    <div className="qr" role="img" aria-label={label} dangerouslySetInnerHTML={{ __html: svg }} />
  );
}

export function ShareSection({ client }: { client?: ShareClient }) {
  const { t } = useI18n();
  const [svc] = useState(() => client ?? createShareClient());
  const [info, setInfo] = useState<ShareInfo>(NOT_SHARING);
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const s = t.share;

  useEffect(() => {
    void svc
      .status()
      .then((i) => {
        setInfo(i);
        setSharing(i.running);
      })
      .catch(() => undefined);
  }, [svc]);

  const apply = (i: ShareInfo) => {
    setInfo(i);
    setSharing(i.running);
  };

  const toggle = async () => {
    setBusy(true);
    setError(undefined);
    try {
      apply(info.running ? await svc.stop() : await svc.start());
    } catch (e) {
      const code = typeof e === "string" ? e : "DEFAULT";
      setError(s.errors[code as keyof typeof s.errors] ?? s.errors.DEFAULT);
    } finally {
      setBusy(false);
    }
  };

  const url = info.urls[0];
  const copy = async () => {
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard blocked: the link is shown and can be selected */
    }
  };

  return (
    <section className="box">
      <h2 className="section-title">{s.title}</h2>
      <p className="caption">{s.help}</p>
      {!svc.available && <p className="note">{s.errors.NOT_DESKTOP}</p>}
      <div className="share-row">
        <span className={`chip ${info.running ? "tone-green" : "tone-gray"}`}>
          {info.running ? s.on : s.off}
        </span>
        <button
          type="button"
          className={info.running ? "btn" : "btn btn--primary"}
          disabled={busy || !svc.available}
          onClick={toggle}
        >
          {info.running ? s.stop : s.start}
        </button>
      </div>
      {error && (
        <p className="note note--error" role="alert">
          {error}
        </p>
      )}
      {info.running && !url && <p className="note">{s.noAddress}</p>}
      {info.running && url && (
        <div className="share-link">
          <Qr text={url} label={s.scan} />
          <div className="share-link__text">
            <strong>{s.scan}</strong>
            <span className="caption">{s.link}</span>
            <code className="share-url">{url}</code>
            <button type="button" className="btn" onClick={copy}>
              {copied ? s.copied : s.copy}
            </button>
          </div>
        </div>
      )}
      {info.running && (
        <CertificateBlock
          secure={info.secureUrls?.[0]}
          profile={info.profileUrl ?? undefined}
          cert={info.certUrl ?? undefined}
        />
      )}
      <ul className="share-warnings">
        {s.warnings.map((w) => (
          <li key={w} className="caption">
            {w}
          </li>
        ))}
      </ul>
    </section>
  );
}

// The phone camera needs an HTTPS page. The computer makes its own certificate authority; the
// phone installs it once (iOS: a profile, then "Certificate Trust Settings").
function CertificateBlock({
  secure,
  profile,
  cert,
}: {
  secure?: string;
  profile?: string;
  cert?: string;
}) {
  const { t } = useI18n();
  const s = t.share.cert;
  const [copied, setCopied] = useState<string>();
  const copy = async (text: string, key: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(key);
      window.setTimeout(() => setCopied(undefined), 1500);
    } catch {
      /* the link is shown and can be selected */
    }
  };
  if (!secure || !profile) return <p className="note">{s.unavailable}</p>;
  return (
    <div className="share-cert">
      <h3 className="section-title">{s.title}</h3>
      <p className="caption">{s.help}</p>
      <ol className="wh-steps">
        {s.steps.map((x) => (
          <li key={x} className="caption">
            {x}
          </li>
        ))}
      </ol>
      <div className="share-link">
        <Qr text={profile} label={s.profile} />
        <div className="share-link__text">
          <strong>{s.profile}</strong>
          <code className="share-url">{profile}</code>
          <button type="button" className="btn" onClick={() => void copy(profile, "p")}>
            {copied === "p" ? t.share.copied : s.copyProfile}
          </button>
          {cert && (
            <button type="button" className="btn" onClick={() => void copy(cert, "c")}>
              {copied === "c" ? t.share.copied : s.copyCert}
            </button>
          )}
        </div>
      </div>
      <div className="share-link">
        <Qr text={secure} label={s.secureLink} />
        <div className="share-link__text">
          <strong>{s.secureLink}</strong>
          <span className="caption">{s.secureHelp}</span>
          <code className="share-url">{secure}</code>
          <button type="button" className="btn" onClick={() => void copy(secure, "s")}>
            {copied === "s" ? t.share.copied : t.share.copy}
          </button>
        </div>
      </div>
      <p className="caption">{s.safety}</p>
    </div>
  );
}
