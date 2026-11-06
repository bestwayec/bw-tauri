//! AES-256-CTR Video Encryption & Decryption Engine for Offline Mode
//!
//! Provides symmetric streaming encryption for offline `.bway` video files,
//! bound to the physical machine using OS machine identifiers and the secure
//! OS credential store (keyring).
//!
//! The file format begins with a 32-byte header:
//! - [0..4]   Magic bytes: `BWAY`
//! - [4]      Version: 1 (u8)
//! - [5..8]   Reserved / flags: [0, 0, 0]
//! - [8..16]  Original plaintext length: u64 (little-endian)
//! - [16..32] Initialization Vector (IV / Nonce): 16 bytes
//! - [32..]   AES-256-CTR ciphertext stream

use std::fs::File;
use std::io::{Read, Seek, SeekFrom, Write};
use std::path::Path;

use aes::Aes256;
use cipher::{KeyIvInit, StreamCipher, StreamCipherSeek};
use ctr::Ctr128BE;
use rand::RngCore;
use sha2::{Digest, Sha256};

pub type Aes256Ctr = Ctr128BE<Aes256>;

pub const BWAY_MAGIC: &[u8; 4] = b"BWAY";
pub const BWAY_VERSION: u8 = 1;
pub const HEADER_SIZE: usize = 32;
#[allow(dead_code)]
pub const STREAM_CHUNK_SIZE: usize = 64 * 1024; // 64 KB streaming buffer (handles 2GB+ without RAM bloat)

const KEYRING_SERVICE: &str = "uz.bestway.exam.media";
const KEYRING_ACCOUNT: &str = "device_video_key_v1";
const APP_MEDIA_SALT: &[u8] = b"uz.bestway.exam.aes256.offline_media.v1";

/// Structured header for `.bway` encrypted containers.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct BwayHeader {
    pub version: u8,
    pub original_len: u64,
    pub iv: [u8; 16],
}

impl BwayHeader {
    pub fn new(original_len: u64, iv: [u8; 16]) -> Self {
        Self {
            version: BWAY_VERSION,
            original_len,
            iv,
        }
    }

    pub fn to_bytes(&self) -> [u8; HEADER_SIZE] {
        let mut header = [0u8; HEADER_SIZE];
        header[0..4].copy_from_slice(BWAY_MAGIC);
        header[4] = self.version;
        // 5..8 reserved flags (0)
        header[8..16].copy_from_slice(&self.original_len.to_le_bytes());
        header[16..32].copy_from_slice(&self.iv);
        header
    }

    pub fn parse(buf: &[u8]) -> Result<Self, String> {
        if buf.len() < HEADER_SIZE {
            return Err("Header buffer too small".to_string());
        }
        if &buf[0..4] != BWAY_MAGIC {
            return Err("Invalid .bway magic header (unrecognized format)".to_string());
        }
        let version = buf[4];
        if version != BWAY_VERSION {
            return Err(format!("Unsupported .bway format version: {version}"));
        }
        let original_len = u64::from_le_bytes(buf[8..16].try_into().unwrap());
        let mut iv = [0u8; 16];
        iv.copy_from_slice(&buf[16..32]);
        Ok(Self {
            version,
            original_len,
            iv,
        })
    }
}

// ---------------------------------------------------------------------------
// Machine-Specific Key Derivation
// ---------------------------------------------------------------------------

fn hex_encode(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{:02x}", b)).collect()
}

fn hex_decode(s: &str) -> Result<Vec<u8>, ()> {
    if !s.is_ascii() || s.len() % 2 != 0 {
        return Err(());
    }
    (0..s.len())
        .step_by(2)
        .map(|i| u8::from_str_radix(&s[i..i + 2], 16).map_err(|_| ()))
        .collect()
}

/// Gathers hardware/OS-level machine identification string.
pub fn get_machine_fingerprint() -> String {
    #[cfg(target_os = "windows")]
    {
        // Query official Windows Cryptography MachineGuid
        if let Ok(output) = std::process::Command::new("reg")
            .args([
                "query",
                "HKLM\\SOFTWARE\\Microsoft\\Cryptography",
                "/v",
                "MachineGuid",
            ])
            .output()
        {
            let text = String::from_utf8_lossy(&output.stdout);
            for line in text.lines() {
                if line.contains("MachineGuid") {
                    if let Some(guid) = line.split_whitespace().last() {
                        return format!("win-mg-{}", guid.trim());
                    }
                }
            }
        }
        let comp = std::env::var("COMPUTERNAME").unwrap_or_else(|_| "pc".into());
        let user = std::env::var("USERNAME").unwrap_or_else(|_| "user".into());
        format!("win-env-{comp}-{user}")
    }

    #[cfg(target_os = "linux")]
    {
        if let Ok(id) = std::fs::read_to_string("/etc/machine-id") {
            let trimmed = id.trim();
            if !trimmed.is_empty() {
                return format!("linux-mid-{}", trimmed);
            }
        }
        if let Ok(id) = std::fs::read_to_string("/var/lib/dbus/machine-id") {
            let trimmed = id.trim();
            if !trimmed.is_empty() {
                return format!("linux-dbus-{}", trimmed);
            }
        }
        let host = std::env::var("HOSTNAME").unwrap_or_else(|_| "linux-pc".into());
        format!("linux-env-{host}")
    }

    #[cfg(target_os = "macos")]
    {
        if let Ok(output) = std::process::Command::new("ioreg")
            .args(["-rd1", "-c", "IOPlatformExpertDevice"])
            .output()
        {
            let text = String::from_utf8_lossy(&output.stdout);
            for line in text.lines() {
                if line.contains("IOPlatformUUID") {
                    if let Some(uuid) = line.split('"').nth(3) {
                        return format!("mac-uuid-{}", uuid.trim());
                    }
                }
            }
        }
        let host = std::env::var("HOSTNAME").unwrap_or_else(|_| "mac-pc".into());
        format!("mac-env-{host}")
    }

    #[cfg(not(any(target_os = "windows", target_os = "linux", target_os = "macos")))]
    {
        "generic-hardware-token".to_string()
    }
}

/// Retrieve or generate a 256-bit symmetric key bound to this device.
///
/// Priority:
/// 1. OS Credential Manager / Keychain / Secret Service via `keyring`.
/// 2. If not stored, generate a key derived from OS Machine ID + crypto entropy,
///    store it in the keyring, and return it.
/// 3. If keyring persistence is unavailable, deterministically derive a hardware key
///    from `MachineGuid` and application salt so playback remains strictly node-locked.
pub fn get_or_derive_machine_key() -> Result<[u8; 32], String> {
    // 1. Try to read from OS keyring
    if let Ok(entry) = keyring::Entry::new(KEYRING_SERVICE, KEYRING_ACCOUNT) {
        if let Ok(hex_str) = entry.get_password() {
            if let Ok(bytes) = hex_decode(&hex_str) {
                if bytes.len() == 32 {
                    let mut key = [0u8; 32];
                    key.copy_from_slice(&bytes);
                    return Ok(key);
                }
            }
        }
    }

    // 2. Hardware fingerprint
    let machine_id = get_machine_fingerprint();

    // 3. Generate key with OS entropy + hardware binding
    let mut rand_bytes = [0u8; 32];
    rand::rngs::OsRng.fill_bytes(&mut rand_bytes);

    let mut hasher = Sha256::new();
    hasher.update(APP_MEDIA_SALT);
    hasher.update(machine_id.as_bytes());
    hasher.update(&rand_bytes);
    let key: [u8; 32] = hasher.finalize().into();

    // 4. Try storing to keyring
    let hex_key = hex_encode(&key);
    if let Ok(entry) = keyring::Entry::new(KEYRING_SERVICE, KEYRING_ACCOUNT) {
        if entry.set_password(&hex_key).is_ok() {
            return Ok(key);
        }
    }

    // 5. Deterministic fallback if keyring write is denied (e.g. headless/restricted sandbox)
    let mut fallback_hasher = Sha256::new();
    fallback_hasher.update(APP_MEDIA_SALT);
    fallback_hasher.update(b"hardware_deterministic_fallback");
    fallback_hasher.update(machine_id.as_bytes());
    let fallback_key: [u8; 32] = fallback_hasher.finalize().into();

    Ok(fallback_key)
}

// ---------------------------------------------------------------------------
// Streaming Encryption (O(1) Memory Usage for 2GB+ Videos)
// ---------------------------------------------------------------------------

/// Streams from any `Read` source and writes an encrypted `.bway` file to disk.
#[allow(dead_code)]
pub fn encrypt_stream_to_file<R: Read>(
    mut reader: R,
    total_len: u64,
    dest_path: &Path,
    key: &[u8; 32],
) -> Result<u64, String> {
    let mut iv = [0u8; 16];
    rand::rngs::OsRng.fill_bytes(&mut iv);

    let header = BwayHeader::new(total_len, iv);
    let mut out_file =
        File::create(dest_path).map_err(|e| format!("Failed to create destination file: {e}"))?;

    out_file
        .write_all(&header.to_bytes())
        .map_err(|e| format!("Failed to write .bway header: {e}"))?;

    let mut cipher = Aes256Ctr::new(key.into(), (&iv).into());
    let mut buffer = vec![0u8; STREAM_CHUNK_SIZE];
    let mut bytes_written: u64 = 0;

    loop {
        let n = reader
            .read(&mut buffer)
            .map_err(|e| format!("Failed to read source stream: {e}"))?;
        if n == 0 {
            break;
        }
        let slice = &mut buffer[..n];
        cipher.apply_keystream(slice);
        out_file
            .write_all(slice)
            .map_err(|e| format!("Failed to write encrypted chunk: {e}"))?;
        bytes_written += n as u64;
    }

    out_file
        .flush()
        .map_err(|e| format!("Failed to flush encrypted file: {e}"))?;

    // If source didn't know its total size up front, back-fill header
    if total_len == 0 && bytes_written > 0 {
        let updated_header = BwayHeader::new(bytes_written, iv);
        out_file
            .seek(SeekFrom::Start(0))
            .map_err(|e| format!("Failed to seek to header: {e}"))?;
        out_file
            .write_all(&updated_header.to_bytes())
            .map_err(|e| format!("Failed to update header length: {e}"))?;
        out_file
            .flush()
            .map_err(|e| format!("Failed to flush header update: {e}"))?;
    }

    Ok(bytes_written)
}

fn download_url(raw: &str, allow_loopback: bool) -> Result<url::Url, String> {
    let parsed = url::Url::parse(raw).map_err(|_| "UNSAFE_MEDIA_URL")?;
    let loopback = match parsed.host() {
        Some(url::Host::Domain(host)) => host.eq_ignore_ascii_case("localhost"),
        Some(url::Host::Ipv4(address)) => address.is_loopback(),
        Some(url::Host::Ipv6(address)) => address.is_loopback(),
        None => false,
    };
    if raw.chars().any(char::is_control)
        || !parsed.username().is_empty()
        || parsed.password().is_some()
        || !(parsed.scheme() == "https" || allow_loopback && parsed.scheme() == "http" && loopback)
    {
        return Err("UNSAFE_MEDIA_URL".into());
    }
    Ok(parsed)
}

/// Download an HTTP video stream and encrypt it directly to disk chunk-by-chunk.
/// Memory footprint stays under ~128 KB regardless of whether video is 50MB or 4GB.
pub async fn download_and_encrypt_video(url: &str, dest_path: &Path) -> Result<u64, String> {
    let destination = download_url(url, cfg!(debug_assertions))?;
    let key = get_or_derive_machine_key()?;

    let client = reqwest::Client::builder()
        .https_only(destination.scheme() == "https")
        .timeout(std::time::Duration::from_secs(7200)) // 2 hour budget for large video downloads
        .build()
        .map_err(|e| format!("HTTP client build failed: {e}"))?;

    let mut response = client
        .get(destination)
        .send()
        .await
        .map_err(|e| format!("Download request failed: {e}"))?;

    if !response.status().is_success() {
        return Err(format!(
            "Download failed with status: {}",
            response.status()
        ));
    }

    let total_len = response.content_length().unwrap_or(0);

    let mut iv = [0u8; 16];
    rand::rngs::OsRng.fill_bytes(&mut iv);

    let header = BwayHeader::new(total_len, iv);
    let mut out_file =
        File::create(dest_path).map_err(|e| format!("Failed to create destination file: {e}"))?;

    out_file
        .write_all(&header.to_bytes())
        .map_err(|e| format!("Failed to write .bway header: {e}"))?;

    let mut cipher = Aes256Ctr::new((&key).into(), (&iv).into());
    let mut bytes_written: u64 = 0;

    while let Some(chunk) = response
        .chunk()
        .await
        .map_err(|e| format!("Network stream error: {e}"))?
    {
        let mut chunk_vec = chunk.to_vec();
        cipher.apply_keystream(&mut chunk_vec);
        out_file
            .write_all(&chunk_vec)
            .map_err(|e| format!("Disk write error: {e}"))?;
        bytes_written += chunk_vec.len() as u64;
    }

    out_file
        .flush()
        .map_err(|e| format!("File flush failed: {e}"))?;

    if total_len == 0 && bytes_written > 0 {
        let updated_header = BwayHeader::new(bytes_written, iv);
        out_file
            .seek(SeekFrom::Start(0))
            .map_err(|e| format!("Seek failed: {e}"))?;
        out_file
            .write_all(&updated_header.to_bytes())
            .map_err(|e| format!("Header update failed: {e}"))?;
        out_file.flush().map_err(|e| format!("Flush failed: {e}"))?;
    }

    Ok(bytes_written)
}

// ---------------------------------------------------------------------------
// Random-Access On-the-Fly Decryption (HTTP 206 Partial Content)
// ---------------------------------------------------------------------------

/// Reads and decrypts an arbitrary byte range `[start .. start + length]` on-the-fly.
///
/// Uses `cipher.seek(start)` to instantly jump to the requested byte position in the
/// keystream without decrypting preceding blocks.
pub fn read_and_decrypt_range<F: Read + Seek>(
    file: &mut F,
    header: &BwayHeader,
    key: &[u8; 32],
    start: u64,
    length: usize,
) -> Result<Vec<u8>, String> {
    if length == 0 {
        return Ok(Vec::new());
    }

    let disk_offset = HEADER_SIZE as u64 + start;
    file.seek(SeekFrom::Start(disk_offset))
        .map_err(|e| format!("Disk seek failed: {e}"))?;

    let mut buffer = vec![0u8; length];
    file.read_exact(&mut buffer)
        .map_err(|e| format!("Disk read failed: {e}"))?;

    let mut cipher = Aes256Ctr::new(key.into(), (&header.iv).into());
    cipher.seek(start);
    cipher.apply_keystream(&mut buffer);

    Ok(buffer)
}

// ---------------------------------------------------------------------------
// Unit Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
pub mod tests {
    use super::*;
    use std::io::Cursor;

    #[test]
    fn corrupt_unicode_keyring_data_is_rejected_without_panicking() {
        assert!(hex_decode("😀").is_err());
        assert!(hex_decode("éé").is_err());
    }

    #[test]
    fn video_downloads_require_tls_except_development_loopback() {
        assert!(download_url("https://cdn.example.test/video.mp4", false).is_ok());
        assert!(download_url("http://127.0.0.1:3101/video.mp4", true).is_ok());
        for raw in [
            "http://cdn.example.test/video.mp4",
            "file:///tmp/video",
            "https://user:pass@cdn.example.test/video",
            "https://cdn.example.test/video\n",
        ] {
            assert!(download_url(raw, false).is_err());
        }
    }

    #[test]
    fn test_bway_header_roundtrip() {
        let iv = [1u8, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16];
        let original_len = 1024 * 1024 * 500; // 500 MB
        let header = BwayHeader::new(original_len, iv);

        let bytes = header.to_bytes();
        assert_eq!(bytes.len(), HEADER_SIZE);
        assert_eq!(&bytes[0..4], BWAY_MAGIC);

        let parsed = BwayHeader::parse(&bytes).expect("Header should parse cleanly");
        assert_eq!(parsed.version, BWAY_VERSION);
        assert_eq!(parsed.original_len, original_len);
        assert_eq!(parsed.iv, iv);
    }

    #[test]
    fn test_full_roundtrip_stream_encryption() {
        let key = [42u8; 32];
        let original_data: Vec<u8> = (0..50000).map(|i| (i % 256) as u8).collect();

        let temp_dir = std::env::temp_dir();
        let test_file = temp_dir.join("test_roundtrip_video.bway");

        let reader = Cursor::new(&original_data);
        let written = encrypt_stream_to_file(reader, original_data.len() as u64, &test_file, &key)
            .expect("Encryption should succeed");
        assert_eq!(written, original_data.len() as u64);

        let mut file = File::open(&test_file).expect("Open encrypted file");
        let mut header_buf = [0u8; HEADER_SIZE];
        file.read_exact(&mut header_buf).expect("Read header");
        let header = BwayHeader::parse(&header_buf).expect("Parse header");
        assert_eq!(header.original_len, original_data.len() as u64);

        let decrypted = read_and_decrypt_range(&mut file, &header, &key, 0, original_data.len())
            .expect("Decryption should succeed");

        assert_eq!(decrypted, original_data);

        let _ = std::fs::remove_file(test_file);
    }

    #[test]
    fn test_random_access_seeking_decryption() {
        let key = [99u8; 32];
        // 256 KB test data
        let original_data: Vec<u8> = (0..256 * 1024)
            .map(|i| ((i * 31 + 7) % 256) as u8)
            .collect();

        let temp_dir = std::env::temp_dir();
        let test_file = temp_dir.join("test_seeking_video.bway");

        let reader = Cursor::new(&original_data);
        encrypt_stream_to_file(reader, original_data.len() as u64, &test_file, &key)
            .expect("Encryption should succeed");

        let mut file = File::open(&test_file).expect("Open encrypted file");
        let mut header_buf = [0u8; HEADER_SIZE];
        file.read_exact(&mut header_buf).expect("Read header");
        let header = BwayHeader::parse(&header_buf).expect("Parse header");

        // 1. Seek to arbitrary non-aligned offset (e.g., byte 12345, length 2048)
        let slice1 =
            read_and_decrypt_range(&mut file, &header, &key, 12345, 2048).expect("Seek to 12345");
        assert_eq!(slice1, original_data[12345..12345 + 2048]);

        // 2. Seek near the end of file
        let end_start = original_data.len() - 1000;
        let slice2 = read_and_decrypt_range(&mut file, &header, &key, end_start as u64, 1000)
            .expect("Seek near end");
        assert_eq!(slice2, original_data[end_start..]);

        // 3. Single byte seek
        let slice3 =
            read_and_decrypt_range(&mut file, &header, &key, 7777, 1).expect("Seek 1 byte");
        assert_eq!(slice3, vec![original_data[7777]]);

        let _ = std::fs::remove_file(test_file);
    }

    #[test]
    fn test_wrong_key_fails_to_decrypt() {
        let key_correct = [1u8; 32];
        let key_wrong = [2u8; 32];
        let original_data = b"Bestway LMS Super Secret Video Payload Content";

        let temp_dir = std::env::temp_dir();
        let test_file = temp_dir.join("test_security_video.bway");

        let reader = Cursor::new(original_data);
        encrypt_stream_to_file(reader, original_data.len() as u64, &test_file, &key_correct)
            .expect("Encryption should succeed");

        let mut file = File::open(&test_file).expect("Open file");
        let mut header_buf = [0u8; HEADER_SIZE];
        file.read_exact(&mut header_buf).expect("Read header");
        let header = BwayHeader::parse(&header_buf).expect("Parse header");

        let decrypted_wrong =
            read_and_decrypt_range(&mut file, &header, &key_wrong, 0, original_data.len())
                .expect("Decryption runs");

        assert_ne!(decrypted_wrong, original_data);

        let _ = std::fs::remove_file(test_file);
    }

    #[test]
    fn test_machine_fingerprint_is_non_empty() {
        let fp = get_machine_fingerprint();
        assert!(!fp.trim().is_empty());
    }

    #[test]
    fn test_machine_key_derivation_is_stable() {
        let key1 = get_or_derive_machine_key().expect("Key 1 should derive");
        let key2 = get_or_derive_machine_key().expect("Key 2 should derive");
        assert_eq!(key1, key2);
        assert_ne!(key1, [0u8; 32]);
    }
}
