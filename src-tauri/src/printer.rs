//! Network receipt/label printer over raw TCP (the "RAW 9100" / JetDirect port that most
//! thermal printers with an Ethernet port accept) using ESC/POS raster graphics.
//!
//! The page is drawn as a bitmap by the UI, so Chinese, Vietnamese or any other text prints
//! without depending on the printer's code pages. Only private-network addresses are allowed:
//! the app must never be a way to push bytes to a host on the internet.

use serde::Serialize;
use std::net::{IpAddr, SocketAddr};
use std::time::Duration;
use tokio::io::AsyncWriteExt;
use tokio::net::TcpStream;
use tokio::time::timeout;

pub const DEFAULT_PORT: u16 = 9100;
pub const MAX_WIDTH_DOTS: usize = 832; // 104 mm at 8 dots/mm
pub const MAX_HEIGHT_DOTS: usize = 6000;
const BAND_ROWS: usize = 128;
const CONNECT_TIMEOUT: Duration = Duration::from_secs(4);
const WRITE_TIMEOUT: Duration = Duration::from_secs(15);

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
pub enum PrintError {
    BadHost,
    BadSize,
    Unreachable,
    Timeout,
    Write,
}

impl PrintError {
    pub fn code(self) -> &'static str {
        match self {
            PrintError::BadHost => "BAD_HOST",
            PrintError::BadSize => "BAD_SIZE",
            PrintError::Unreachable => "UNREACHABLE",
            PrintError::Timeout => "TIMEOUT",
            PrintError::Write => "WRITE",
        }
    }
}

/// An IP literal on the local network (private, link-local or loopback) and a valid port.
pub fn parse_target(host: &str, port: u16) -> Result<SocketAddr, PrintError> {
    if port == 0 {
        return Err(PrintError::BadHost);
    }
    let ip: IpAddr = host.trim().parse().map_err(|_| PrintError::BadHost)?;
    let local = match ip {
        IpAddr::V4(v4) => v4.is_private() || v4.is_loopback() || v4.is_link_local(),
        IpAddr::V6(v6) => v6.is_loopback(),
    };
    if !local {
        return Err(PrintError::BadHost);
    }
    Ok(SocketAddr::new(ip, port))
}

/// Build the ESC/POS job: init, raster bands, feed, partial cut.
/// `bits` is `ceil(width/8)` bytes per row, 1 = black, most significant bit first.
pub fn build_job(width: usize, height: usize, bits: &[u8]) -> Result<Vec<u8>, PrintError> {
    if width == 0 || height == 0 || width > MAX_WIDTH_DOTS || height > MAX_HEIGHT_DOTS {
        return Err(PrintError::BadSize);
    }
    let row_bytes = width.div_ceil(8);
    if bits.len() != row_bytes * height {
        return Err(PrintError::BadSize);
    }
    let mut out = vec![0x1b, 0x40]; // ESC @
    for band in bits.chunks(row_bytes * BAND_ROWS) {
        let rows = band.len() / row_bytes;
        // GS v 0 m xL xH yL yH d1...dk
        out.extend_from_slice(&[0x1d, 0x76, 0x30, 0x00]);
        out.extend_from_slice(&(row_bytes as u16).to_le_bytes());
        out.extend_from_slice(&(rows as u16).to_le_bytes());
        out.extend_from_slice(band);
    }
    out.extend_from_slice(&[0x1b, 0x64, 0x04]); // ESC d 4: feed 4 lines
    out.extend_from_slice(&[0x1d, 0x56, 0x42, 0x00]); // GS V 66 0: feed and partial cut
    Ok(out)
}

pub async fn send(addr: SocketAddr, data: &[u8]) -> Result<(), PrintError> {
    let mut stream = timeout(CONNECT_TIMEOUT, TcpStream::connect(addr))
        .await
        .map_err(|_| PrintError::Timeout)?
        .map_err(|_| PrintError::Unreachable)?;
    timeout(WRITE_TIMEOUT, async {
        stream.write_all(data).await?;
        stream.flush().await?;
        stream.shutdown().await
    })
    .await
    .map_err(|_| PrintError::Timeout)?
    .map_err(|_| PrintError::Write)
}

/// Only checks that the printer accepts a connection; nothing is printed.
pub async fn probe(addr: SocketAddr) -> Result<(), PrintError> {
    timeout(CONNECT_TIMEOUT, TcpStream::connect(addr))
        .await
        .map_err(|_| PrintError::Timeout)?
        .map(|_| ())
        .map_err(|_| PrintError::Unreachable)
}

#[cfg(test)]
mod tests {
    use super::*;
    use tokio::io::AsyncReadExt;
    use tokio::net::TcpListener;

    #[test]
    fn only_local_addresses_are_allowed() {
        for ok in [
            "192.168.1.50",
            "10.0.0.7",
            "172.16.4.2",
            "127.0.0.1",
            "169.254.1.1",
            "::1",
        ] {
            assert!(parse_target(ok, 9100).is_ok(), "{ok}");
        }
        for bad in [
            "8.8.8.8",
            "printer.local",
            "",
            "172.32.0.1",
            "2001:db8::1",
            "1.1.1.1",
        ] {
            assert_eq!(parse_target(bad, 9100), Err(PrintError::BadHost), "{bad}");
        }
        assert_eq!(parse_target("192.168.1.5", 0), Err(PrintError::BadHost));
    }

    #[test]
    fn job_has_init_raster_header_feed_and_cut() {
        let width = 16; // 2 bytes per row
        let bits = vec![0xff; 2 * 3];
        let job = build_job(width, 3, &bits).unwrap();
        assert_eq!(&job[..2], &[0x1b, 0x40]);
        assert_eq!(&job[2..6], &[0x1d, 0x76, 0x30, 0x00]);
        assert_eq!(&job[6..10], &[2, 0, 3, 0]); // 2 bytes/row, 3 rows
        assert_eq!(&job[10..16], &bits[..]);
        assert!(job.ends_with(&[0x1d, 0x56, 0x42, 0x00]));
    }

    #[test]
    fn tall_pages_are_split_into_bands() {
        let rows = BAND_ROWS * 2 + 5;
        let bits = vec![0u8; 48 * rows];
        let job = build_job(384, rows, &bits).unwrap();
        let headers = job
            .windows(4)
            .filter(|w| w == &[0x1d, 0x76, 0x30, 0x00])
            .count();
        assert_eq!(headers, 3);
    }

    #[test]
    fn wrong_sizes_are_rejected() {
        assert_eq!(build_job(0, 1, &[]), Err(PrintError::BadSize));
        assert_eq!(build_job(16, 2, &[0; 3]), Err(PrintError::BadSize));
        assert_eq!(
            build_job(MAX_WIDTH_DOTS + 8, 1, &vec![0; 105]),
            Err(PrintError::BadSize)
        );
        assert_eq!(
            build_job(8, MAX_HEIGHT_DOTS + 1, &vec![0; MAX_HEIGHT_DOTS + 1]),
            Err(PrintError::BadSize)
        );
    }

    #[tokio::test]
    async fn sends_the_exact_bytes_to_a_loopback_printer() {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        let server = tokio::spawn(async move {
            let (mut s, _) = listener.accept().await.unwrap();
            let mut got = Vec::new();
            s.read_to_end(&mut got).await.unwrap();
            got
        });
        let job = build_job(8, 2, &[0xaa, 0x55]).unwrap();
        send(addr, &job).await.unwrap();
        assert_eq!(server.await.unwrap(), job);
    }

    #[tokio::test]
    async fn a_closed_port_is_reported_as_unreachable() {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        drop(listener);
        assert_eq!(probe(addr).await, Err(PrintError::Unreachable));
        assert_eq!(send(addr, &[1]).await, Err(PrintError::Unreachable));
    }
}
