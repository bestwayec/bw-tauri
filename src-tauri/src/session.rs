//! Durable auth session owned by Rust (Phase 1).
//!
//! Why Rust owns the tokens:
//! - Refresh tokens ROTATE on every use and reuse revokes the whole family.
//!   A webview crash/reload between "refresh returned" and "tokens persisted"
//!   would lose the new pair and log the student out. Persisting inside the
//!   same Rust command that performs the refresh closes that window.
//! - Exactly one refresh may run at a time (Rust async mutex + the caller's
//!   expected access token: a waiter whose token already changed adopts the
//!   stored pair instead of POSTing again).
//!
//! Storage: OS credential store (`keyring`: Credential Manager / Keychain /
//! Secret Service). Where no secret service exists (headless Linux), an
//! atomic file fallback in the app data dir with restricted permissions
//! (0600 on unix) is used and the downgrade is logged. Tokens are never
//! logged.

use std::path::{Path, PathBuf};
use std::sync::Mutex as StdMutex;
use std::time::Duration;

use serde::{Deserialize, Serialize};

const KEYRING_SERVICE: &str = "uz.bestway.exam";
const KEYRING_ACCOUNT: &str = "session";
const SESSION_FILE: &str = "session.json";

/// Everything the client needs to resume without asking for a password.
#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq, Eq)]
pub struct SessionData {
    #[serde(default)]
    pub access_token: Option<String>,
    #[serde(default)]
    pub refresh_token: Option<String>,
    #[serde(default)]
    pub device_id: Option<String>,
    /// Cached `/auth/me` user JSON (lets boot render instantly/offline).
    #[serde(default)]
    pub profile_json: Option<String>,
}

impl SessionData {
    pub fn is_empty(&self) -> bool {
        self.access_token.is_none() && self.refresh_token.is_none()
    }
}

// ---------------------------------------------------------------------------
// Pure decision helpers (unit-tested)
// ---------------------------------------------------------------------------

/// True when the caller must adopt the stored pair instead of refreshing:
/// its access token no longer matches, so another instance already rotated.
pub fn should_reuse_stored(stored_access: Option<&str>, expected_access: Option<&str>) -> bool {
    match (stored_access, expected_access) {
        (Some(stored), Some(expected)) => stored != expected,
        // Caller holds nothing but a pair exists (e.g. after relaunch):
        // adopt it rather than spending the refresh token.
        (Some(_), None) => true,
        _ => false,
    }
}

/// Backend verdicts that definitively end a session live in JS
/// (`DEFINITIVE_LOGOUT_CODES` in `src/lib/session-store.ts`, unit-tested
/// there next to the wipe policy). Rust only transports the verdict code.
/// Same split for offline backoff: the retry loop runs in JS.


// ---------------------------------------------------------------------------
// Disk layout: keyring first, atomic file fallback
// ---------------------------------------------------------------------------

fn session_file(dir: &Path) -> PathBuf {
    dir.join(SESSION_FILE)
}

fn read_file_store(dir: &Path) -> Option<SessionData> {
    let raw = std::fs::read(session_file(dir)).ok()?;
    serde_json::from_slice(&raw).ok()
}

/// Atomic write (temp file + rename) with restricted permissions on unix.
fn write_file_store(dir: &Path, data: &SessionData) -> std::io::Result<()> {
    std::fs::create_dir_all(dir)?;
    let raw = serde_json::to_vec(data).map_err(|e| std::io::Error::new(std::io::ErrorKind::Other, e))?;
    let tmp = dir.join(format!("{SESSION_FILE}.tmp"));
    std::fs::write(&tmp, raw)?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(&tmp, std::fs::Permissions::from_mode(0o600))?;
    }
    std::fs::rename(&tmp, session_file(dir))?;
    Ok(())
}

fn remove_file_store(dir: &Path) {
    let _ = std::fs::remove_file(session_file(dir));
}

/// Load order: keyring -> file fallback (which then re-seeds keyring).
pub fn load_from_disk(app_dir: &Path) -> (SessionData, bool) {
    match keyring::Entry::new(KEYRING_SERVICE, KEYRING_ACCOUNT)
        .and_then(|e| e.get_password())
    {
        Ok(raw) => match serde_json::from_str::<SessionData>(&raw) {
            Ok(data) => return (data, false),
            Err(e) => eprintln!("[session] keyring payload unreadable, trying file fallback: {e}"),
        },
        Err(e) => eprintln!("[session] keyring unavailable, using file fallback: {e}"),
    }
    match read_file_store(app_dir) {
        Some(data) => (data, true),
        None => (SessionData::default(), true),
    }
}

pub fn save_to_disk(app_dir: &Path, data: &SessionData) {
    let raw = serde_json::to_string(data).unwrap_or_default();
    match keyring::Entry::new(KEYRING_SERVICE, KEYRING_ACCOUNT)
        .and_then(|e| e.set_password(&raw))
    {
        Ok(()) => {
            // Keyring won: drop any stale file copy so only one store holds tokens.
            remove_file_store(app_dir);
        }
        Err(e) => {
            eprintln!("[session] keyring write failed, file fallback: {e}");
            if let Err(io) = write_file_store(app_dir, data) {
                eprintln!("[session] file fallback write failed: {io}");
            }
        }
    }
}

pub fn clear_disk(app_dir: &Path) {
    if let Ok(entry) = keyring::Entry::new(KEYRING_SERVICE, KEYRING_ACCOUNT) {
        let _ = entry.delete_credential();
    }
    remove_file_store(app_dir);
}

// ---------------------------------------------------------------------------
// Managed state + refresh ownership
// ---------------------------------------------------------------------------

pub struct SessionStore {
    mem: StdMutex<SessionData>,
    /// Serializes refresh: exactly one POST /auth/refresh at a time.
    refresh_lock: tauri::async_runtime::Mutex<()>,
    /// Resolved in `setup` (needs the app handle); temp dir until then.
    app_dir: StdMutex<PathBuf>,
}

impl Default for SessionStore {
    fn default() -> Self {
        Self::new()
    }
}

impl SessionStore {
    pub fn new() -> Self {
        let fallback = std::env::temp_dir();
        let (data, _) = load_from_disk(&fallback);
        Self {
            mem: StdMutex::new(data),
            refresh_lock: tauri::async_runtime::Mutex::new(()),
            app_dir: StdMutex::new(fallback),
        }
    }

    /// Point the file fallback at the real app data dir + reload disk state.
    /// Called once from `setup`; after this the memory snapshot is authoritative.
    pub fn init_app_dir(&self, dir: PathBuf) {
        if let Ok(mut slot) = self.app_dir.lock() {
            *slot = dir.clone();
        }
        let (data, _) = load_from_disk(&dir);
        if !data.is_empty() {
            if let Ok(mut g) = self.mem.lock() {
                *g = data;
            }
        }
    }

    fn dir(&self) -> PathBuf {
        self.app_dir.lock().map(|g| g.clone()).unwrap_or_else(|_| std::env::temp_dir())
    }

    pub fn snapshot(&self) -> SessionData {
        self.mem.lock().map(|g| g.clone()).unwrap_or_default()
    }

    pub fn store(&self, data: SessionData) {
        if let Ok(mut g) = self.mem.lock() {
            *g = data.clone();
        }
        save_to_disk(&self.dir(), &data);
    }

    pub fn clear(&self) {
        if let Ok(mut g) = self.mem.lock() {
            *g = SessionData::default();
        }
        clear_disk(&self.dir());
    }

    /// Refresh the pair. `expected_access` is the caller's current access
    /// token: if memory already holds something else, another instance won
    /// the race — adopt it without spending the refresh token.
    pub async fn refresh(&self, base_url: &str, expected_access: Option<String>) -> Result<String, String> {
        let _guard = self.refresh_lock.lock().await;

        let current = self.snapshot();
        if should_reuse_stored(current.access_token.as_deref(), expected_access.as_deref()) {
            return current
                .access_token
                .ok_or_else(|| "NO_SESSION".to_string());
        }
        let refresh_token = current.refresh_token.ok_or_else(|| "NO_REFRESH_TOKEN".to_string())?;

        let url = format!("{}/auth/refresh", base_url.trim_end_matches('/'));
        let client = reqwest::Client::builder()
            .timeout(Duration::from_secs(10))
            .build()
            .map_err(|e| format!("HTTP_CLIENT: {e}"))?;
        let res = client
            .post(url)
            .json(&serde_json::json!({ "refreshToken": refresh_token }))
            .send()
            .await
            .map_err(|e| {
                if e.is_timeout() {
                    "HTTP_TIMEOUT: refresh timed out".to_string()
                } else {
                    format!("NETWORK_ERROR: {e}")
                }
            })?;

        let status = res.status();
        let text = res.text().await.unwrap_or_default();
        let payload: serde_json::Value = serde_json::from_str(&text).unwrap_or(serde_json::Value::Null);
        // Backend envelope: { success, data } or { success:false, error:{code,message} }.
        let data = payload.get("data");
        let err_obj = payload.get("error");
        if !status.is_success() || data.is_none() || data == Some(&serde_json::Value::Null) {
            let code = err_obj
                .and_then(|e| e.get("code"))
                .and_then(|c| c.as_str())
                .unwrap_or("REFRESH_FAILED");
            // Reuse/expiry verdicts end the session; anything else is transient.
            return Err(code.to_string());
        }
        let access = data
            .and_then(|d| d.get("accessToken"))
            .and_then(|v| v.as_str())
            .ok_or_else(|| "SCHEMA_MISMATCH: refresh response has no accessToken".to_string())?;
        // Rotation: backend may or may not return a new refresh token.
        let rotated = data
            .and_then(|d| d.get("refreshToken"))
            .and_then(|v| v.as_str())
            .map(str::to_string)
            .unwrap_or(refresh_token);

        let next = SessionData {
            access_token: Some(access.to_string()),
            refresh_token: Some(rotated),
            device_id: current.device_id.clone(),
            profile_json: current.profile_json.clone(),
        };
        // Persist BEFORE returning: a crash after this point keeps the pair.
        self.store(next);
        Ok(access.to_string())
    }
}

// ---------------------------------------------------------------------------
// Tauri commands (least-privilege: no extra capabilities needed — the app's
// own commands are invokable from its main window like the existing ones)
// ---------------------------------------------------------------------------

#[tauri::command]
pub fn session_get(store: tauri::State<'_, SessionStore>) -> SessionData {
    store.snapshot()
}

#[tauri::command]
pub fn session_set(store: tauri::State<'_, SessionStore>, data: SessionData) -> Result<(), String> {
    store.store(data);
    Ok(())
}

#[tauri::command]
pub fn session_clear(store: tauri::State<'_, SessionStore>) -> Result<(), String> {
    store.clear();
    Ok(())
}

impl SessionStore {
    /// Best-effort server logout: revoke the stored refresh token, then wipe
    /// everything locally no matter what the server says.
    pub async fn logout(&self, base_url: &str) {
        if let Some(rt) = self.snapshot().refresh_token {
            let url = format!("{}/auth/logout", base_url.trim_end_matches('/'));
            if let Ok(client) = reqwest::Client::builder()
                .timeout(Duration::from_secs(10))
                .build()
            {
                let _ = client
                    .post(url)
                    .json(&serde_json::json!({ "refreshToken": rt }))
                    .send()
                    .await;
            }
        }
        self.clear();
    }
}

#[tauri::command]
pub async fn auth_logout(store: tauri::State<'_, SessionStore>, base_url: String) -> Result<(), String> {
    store.logout(&base_url).await;
    Ok(())
}

#[tauri::command]
pub async fn auth_refresh(
    store: tauri::State<'_, SessionStore>,
    base_url: String,
    expected_access: Option<String>,
) -> Result<String, String> {
    // Basic SSRF guard: only http(s) backend URLs.
    let lower = base_url.trim().to_lowercase();
    if !(lower.starts_with("https://") || lower.starts_with("http://")) {
        return Err("UNSAFE_URL: refusing to refresh against a non-http(s) URL".to_string());
    }
    store.refresh(&base_url, expected_access).await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reuse_when_stored_differs() {
        assert!(should_reuse_stored(Some("new"), Some("old")));
        assert!(should_reuse_stored(Some("x"), None));
        assert!(!should_reuse_stored(Some("same"), Some("same")));
        assert!(!should_reuse_stored(None, Some("old")));
        assert!(!should_reuse_stored(None, None));
    }

    #[test]
    fn file_store_roundtrips_atomically() {
        let dir = std::env::temp_dir().join(format!("bw-tauri-test-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        let data = SessionData {
            access_token: Some("a".into()),
            refresh_token: Some("r".into()),
            device_id: Some("d".into()),
            profile_json: Some("{}".into()),
        };
        write_file_store(&dir, &data).unwrap();
        assert_eq!(read_file_store(&dir), Some(data));
        assert!(!session_file(&dir).with_extension("tmp").exists() && !dir.join("session.json.tmp").exists());
        remove_file_store(&dir);
        assert_eq!(read_file_store(&dir), None);
        let _ = std::fs::remove_dir_all(&dir);
    }
}
