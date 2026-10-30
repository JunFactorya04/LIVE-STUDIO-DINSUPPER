//! A small certificate authority of this app, so the phone link can use HTTPS.
//!
//! A phone browser only gives a page the camera when the page is served over HTTPS. The computer
//! therefore makes (once) a local CA and, each time sharing starts, a server certificate for its
//! own network addresses. The seller installs the CA on the phone (iOS: a `.mobileconfig` profile,
//! then "Certificate Trust Settings"). Safety:
//!   * the CA is limited by NameConstraints to private network addresses, so even if its key
//!     leaked it could not vouch for a public website;
//!   * the CA key stays in this app's data folder (owner-only permissions on Unix), is never sent
//!     anywhere and the phone only ever receives the public certificate;
//!   * the server certificate lives 800 days (iOS refuses longer) and is remade at every start.

use rcgen::{
    date_time_ymd, BasicConstraints, CertificateParams, CidrSubnet, DistinguishedName, DnType,
    ExtendedKeyUsagePurpose, GeneralSubtree, IsCa, Issuer, KeyPair, KeyUsagePurpose,
    NameConstraints, SanType,
};
use rustls::pki_types::{CertificateDer, PrivateKeyDer, PrivatePkcs8KeyDer};
use std::net::IpAddr;
use std::path::Path;
use std::sync::Arc;

const CA_CERT: &str = "live-studio-ca.pem";
const CA_KEY: &str = "live-studio-ca.key";
const CA_NAME: &str = "LIVE STUDIO local CA";

pub struct Certs {
    pub ca_der: Vec<u8>,
    pub server: Arc<rustls::ServerConfig>,
}

/// (year, month, day) of today, from the system clock (UTC).
fn today() -> (i32, u8, u8) {
    let secs = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    civil((secs / 86_400) as i64)
}

/// Days since 1970-01-01 to a calendar date (Howard Hinnant's algorithm).
pub fn civil(z: i64) -> (i32, u8, u8) {
    let z = z + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z.rem_euclid(146_097);
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = (doy - (153 * mp + 2) / 5 + 1) as u8;
    let m = if mp < 10 { mp + 3 } else { mp - 9 } as u8;
    ((y + i64::from(m <= 2)) as i32, m, d)
}

fn ca_params() -> CertificateParams {
    let mut p = CertificateParams::default();
    let mut dn = DistinguishedName::new();
    dn.push(DnType::CommonName, CA_NAME);
    dn.push(DnType::OrganizationName, "LIVE STUDIO");
    p.distinguished_name = dn;
    p.is_ca = IsCa::Ca(BasicConstraints::Constrained(0));
    p.key_usages = vec![KeyUsagePurpose::KeyCertSign, KeyUsagePurpose::CrlSign];
    p.name_constraints = Some(NameConstraints {
        permitted_subtrees: vec![
            GeneralSubtree::IpAddress(CidrSubnet::from_v4_prefix([10, 0, 0, 0], 8)),
            GeneralSubtree::IpAddress(CidrSubnet::from_v4_prefix([172, 16, 0, 0], 12)),
            GeneralSubtree::IpAddress(CidrSubnet::from_v4_prefix([192, 168, 0, 0], 16)),
            GeneralSubtree::IpAddress(CidrSubnet::from_v4_prefix([169, 254, 0, 0], 16)),
            GeneralSubtree::IpAddress(CidrSubnet::from_v4_prefix([127, 0, 0, 0], 8)),
        ],
        excluded_subtrees: vec![],
    });
    let (y, m, d) = today();
    p.not_before = date_time_ymd(y - 1, m, d.min(28));
    p.not_after = date_time_ymd(y + 20, m, d.min(28));
    p
}

fn load_or_make_ca(dir: &Path) -> Result<(KeyPair, String, Vec<u8>), String> {
    let cert_path = dir.join(CA_CERT);
    let key_path = dir.join(CA_KEY);
    if let (Ok(cert_pem), Ok(key_pem)) = (
        std::fs::read_to_string(&cert_path),
        std::fs::read_to_string(&key_path),
    ) {
        if let (Ok(key), Ok(pem)) = (KeyPair::from_pem(&key_pem), pem_to_der(&cert_pem)) {
            return Ok((key, cert_pem, pem));
        }
    }
    std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    let key = KeyPair::generate().map_err(|e| e.to_string())?;
    let cert = ca_params().self_signed(&key).map_err(|e| e.to_string())?;
    let pem = cert.pem();
    std::fs::write(&cert_path, &pem).map_err(|e| e.to_string())?;
    std::fs::write(&key_path, key.serialize_pem()).map_err(|e| e.to_string())?;
    restrict(&key_path);
    Ok((key, pem, cert.der().to_vec()))
}

#[cfg(unix)]
fn restrict(p: &Path) {
    use std::os::unix::fs::PermissionsExt;
    let _ = std::fs::set_permissions(p, std::fs::Permissions::from_mode(0o600));
}
#[cfg(not(unix))]
fn restrict(_: &Path) {}

fn pem_to_der(pem: &str) -> Result<Vec<u8>, String> {
    let body: String = pem
        .lines()
        .filter(|l| !l.starts_with("-----"))
        .collect::<Vec<_>>()
        .concat();
    base64_decode(&body).ok_or_else(|| "BAD_PEM".to_string())
}

const B64: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

pub fn base64_encode(data: &[u8]) -> String {
    let mut out = String::with_capacity(data.len().div_ceil(3) * 4);
    for c in data.chunks(3) {
        let n = (u32::from(c[0]) << 16)
            | (u32::from(*c.get(1).unwrap_or(&0)) << 8)
            | u32::from(*c.get(2).unwrap_or(&0));
        out.push(B64[(n >> 18) as usize & 63] as char);
        out.push(B64[(n >> 12) as usize & 63] as char);
        out.push(if c.len() > 1 {
            B64[(n >> 6) as usize & 63] as char
        } else {
            '='
        });
        out.push(if c.len() > 2 {
            B64[n as usize & 63] as char
        } else {
            '='
        });
    }
    out
}

pub fn base64_decode(s: &str) -> Option<Vec<u8>> {
    let mut out = Vec::with_capacity(s.len() / 4 * 3);
    let mut buf = 0u32;
    let mut bits = 0;
    for ch in s.bytes().filter(|b| !b.is_ascii_whitespace() && *b != b'=') {
        let v = B64.iter().position(|&b| b == ch)? as u32;
        buf = (buf << 6) | v;
        bits += 6;
        if bits >= 8 {
            bits -= 8;
            out.push((buf >> bits) as u8);
            buf &= (1 << bits) - 1;
        }
    }
    Some(out)
}

/// The CA (made on first use and kept) and a fresh server certificate for `ips`.
pub fn load_or_create(dir: &Path, ips: &[IpAddr]) -> Result<Certs, String> {
    let (ca_key, _pem, ca_der) = load_or_make_ca(dir)?;
    let issuer = Issuer::new(ca_params(), ca_key);

    let mut params = CertificateParams::default();
    let mut dn = DistinguishedName::new();
    dn.push(DnType::CommonName, "LIVE STUDIO phone link");
    params.distinguished_name = dn;
    params.is_ca = IsCa::NoCa;
    params.key_usages = vec![
        KeyUsagePurpose::DigitalSignature,
        KeyUsagePurpose::KeyEncipherment,
    ];
    params.extended_key_usages = vec![ExtendedKeyUsagePurpose::ServerAuth];
    params.subject_alt_names = ips.iter().map(|ip| SanType::IpAddress(*ip)).collect();
    let (y, m, d) = today();
    params.not_before = date_time_ymd(y, m, d.min(28));
    // 800 days at most: iOS rejects server certificates that live longer than 825.
    let (ey, em, ed) = civil(
        (std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_secs())
            .unwrap_or(0)
            / 86_400) as i64
            + 800,
    );
    params.not_after = date_time_ymd(ey, em, ed.min(28));

    let key = KeyPair::generate().map_err(|e| e.to_string())?;
    let cert = params.signed_by(&key, &issuer).map_err(|e| e.to_string())?;

    let chain = vec![
        CertificateDer::from(cert.der().to_vec()),
        CertificateDer::from(ca_der.clone()),
    ];
    let pkey = PrivateKeyDer::Pkcs8(PrivatePkcs8KeyDer::from(key.serialize_der()));
    let provider = Arc::new(rustls::crypto::ring::default_provider());
    let server = rustls::ServerConfig::builder_with_provider(provider)
        .with_safe_default_protocol_versions()
        .map_err(|e| e.to_string())?
        .with_no_client_auth()
        .with_single_cert(chain, pkey)
        .map_err(|e| e.to_string())?;
    Ok(Certs {
        ca_der,
        server: Arc::new(server),
    })
}

/// An iOS configuration profile that installs the CA as a root certificate. It is not signed, so
/// iOS says "Not Signed"; the seller still has to install it and then trust it by hand.
pub fn mobileconfig(ca_der: &[u8]) -> String {
    let b64 = base64_encode(ca_der);
    let wrapped: Vec<&str> = b64
        .as_bytes()
        .chunks(64)
        .map(|c| std::str::from_utf8(c).unwrap_or(""))
        .collect();
    format!(
        r#"<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>PayloadContent</key>
  <array>
    <dict>
      <key>PayloadCertificateFileName</key><string>live-studio-ca.cer</string>
      <key>PayloadContent</key>
      <data>
{}
      </data>
      <key>PayloadDescription</key><string>Chứng chỉ để điện thoại mở link LIVE STUDIO qua HTTPS (dùng camera quét mã).</string>
      <key>PayloadDisplayName</key><string>{CA_NAME}</string>
      <key>PayloadIdentifier</key><string>app.livestudio.ca.cert</string>
      <key>PayloadType</key><string>com.apple.security.root</string>
      <key>PayloadUUID</key><string>8E1F2D0A-5B7C-4F3E-9A61-2C4D7B9E0F11</string>
      <key>PayloadVersion</key><integer>1</integer>
    </dict>
  </array>
  <key>PayloadDescription</key><string>Tin cậy chứng chỉ cục bộ của LIVE STUDIO (chỉ cho địa chỉ mạng nội bộ).</string>
  <key>PayloadDisplayName</key><string>{CA_NAME}</string>
  <key>PayloadIdentifier</key><string>app.livestudio.ca</string>
  <key>PayloadRemovalDisallowed</key><false/>
  <key>PayloadType</key><string>Configuration</string>
  <key>PayloadUUID</key><string>3B6A9C52-1D84-4E07-B2F5-7A0C8E4D9136</string>
  <key>PayloadVersion</key><integer>1</integer>
</dict>
</plist>
"#,
        wrapped.join("\n")
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn base64_round_trips() {
        for n in 0..40usize {
            let data: Vec<u8> = (0..n).map(|i| (i * 7 + 3) as u8).collect();
            assert_eq!(base64_decode(&base64_encode(&data)).unwrap(), data);
        }
        assert_eq!(base64_encode(b"Man"), "TWFu");
        assert_eq!(base64_encode(b"Ma"), "TWE=");
    }

    #[test]
    fn calendar_dates() {
        assert_eq!(civil(0), (1970, 1, 1));
        assert_eq!(civil(19_723), (2024, 1, 1));
        assert_eq!(civil(11_016), (2000, 2, 29));
    }

    #[test]
    fn the_ca_is_kept_and_signs_a_server_certificate_for_the_lan_address() {
        let dir = std::env::temp_dir().join(format!("ls-ca-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        let ip: IpAddr = "192.168.1.20".parse().unwrap();
        let a = load_or_create(&dir, &[ip]).unwrap();
        let b = load_or_create(&dir, &[ip]).unwrap();
        // Same CA both times: a profile installed once keeps working.
        assert_eq!(a.ca_der, b.ca_der);
        assert!(dir.join(CA_KEY).exists());
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn the_profile_carries_the_certificate_as_a_root_payload() {
        let p = mobileconfig(&[1, 2, 3, 4]);
        assert!(p.contains("com.apple.security.root"));
        assert!(p.contains("AQIDBA=="));
        assert!(p.contains("<plist"));
    }

    /// A real TLS handshake: a client that trusts only our CA accepts the server certificate for
    /// the address, which proves the chain, the address entry and the name constraints agree.
    #[tokio::test]
    async fn a_client_that_trusts_the_ca_completes_the_handshake() {
        use tokio::io::{AsyncReadExt, AsyncWriteExt};
        let dir = std::env::temp_dir().join(format!("ls-tls-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        let ip: IpAddr = "192.168.1.20".parse().unwrap();
        let loopback: IpAddr = "127.0.0.1".parse().unwrap();
        let certs = load_or_create(&dir, &[ip, loopback]).unwrap();

        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        let acceptor = tokio_rustls::TlsAcceptor::from(certs.server.clone());
        tokio::spawn(async move {
            let (s, _) = listener.accept().await.unwrap();
            let mut t = acceptor.accept(s).await.unwrap();
            t.write_all(b"hello").await.unwrap();
            t.shutdown().await.unwrap();
        });

        let mut roots = rustls::RootCertStore::empty();
        roots
            .add(CertificateDer::from(certs.ca_der.clone()))
            .unwrap();
        let provider = Arc::new(rustls::crypto::ring::default_provider());
        let cfg = rustls::ClientConfig::builder_with_provider(provider)
            .with_safe_default_protocol_versions()
            .unwrap()
            .with_root_certificates(roots)
            .with_no_client_auth();
        let tcp = tokio::net::TcpStream::connect(addr).await.unwrap();
        let name = rustls::pki_types::ServerName::IpAddress(loopback.into());
        let mut tls = tokio_rustls::TlsConnector::from(Arc::new(cfg))
            .connect(name, tcp)
            .await
            .unwrap();
        let mut got = String::new();
        let _ = tls.read_to_string(&mut got).await;
        assert_eq!(got, "hello");
        let _ = std::fs::remove_dir_all(&dir);
    }
}
