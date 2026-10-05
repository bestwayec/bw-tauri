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
const DEFAULT_API_BASE_URL: &str = "https://api.bestwayec.uz/v1";

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

// Match the frontend configuration priority. Release CI exports VITE_API_URL to
// both Vite and Cargo; custom staging builds must do the same. Debug builds also
// accept loopback because local Vite .env files are not exported to Cargo.
fn configured_api_base_url() -> &'static str {
    option_env!("BESTWAY_API_URL")
        .or(option_env!("VITE_API_URL"))
        .filter(|value| !value.trim().is_empty())
        .unwrap_or(DEFAULT_API_BASE_URL)
}

fn loopback_url(url: &url::Url) -> bool {
    match url.host() {
        Some(url::Host::Domain(host)) => host.eq_ignore_ascii_case("localhost"),
        Some(url::Host::Ipv4(address)) => address.is_loopback(),
        Some(url::Host::Ipv6(address)) => address.is_loopback(),
        None => false,
    }
}

fn auth_endpoint_for(
    base_url: &str,
    action: &str,
    configured_base: &str,
    allow_dev_loopback: bool,
) -> Result<url::Url, String> {
    let unsafe_url = || {
        "UNSAFE_URL: authentication destination does not match the configured backend".to_string()
    };
    let parse_base = |value: &str| -> Result<url::Url, String> {
        if value.chars().any(char::is_control) {
            return Err(unsafe_url());
        }
        let parsed = url::Url::parse(value.trim()).map_err(|_| unsafe_url())?;
        if !parsed.username().is_empty()
            || parsed.password().is_some()
            || parsed.query().is_some()
            || parsed.fragment().is_some()
            || !(parsed.scheme() == "https"
                || (allow_dev_loopback && parsed.scheme() == "http" && loopback_url(&parsed)))
        {
            return Err(unsafe_url());
        }
        Ok(parsed)
    };
    let mut requested = parse_base(base_url)?;
    let configured = parse_base(configured_base)?;
    let same_backend = requested.origin() == configured.origin()
        && requested.path().trim_end_matches('/') == configured.path().trim_end_matches('/');
    if !same_backend && !(allow_dev_loopback && loopback_url(&requested)) {
        return Err(unsafe_url());
    }
    requested.set_path(&format!(
        "{}/auth/{action}",
        requested.path().trim_end_matches('/')
    ));
    Ok(requested)
}

fn auth_endpoint(base_url: &str, action: &str) -> Result<url::Url, String> {
    auth_endpoint_for(
        base_url,
        action,
        configured_api_base_url(),
        cfg!(debug_assertions),
    )
}

// Backend verdicts that definitively end a session live in JS
// (`DEFINITIVE_LOGOUT_CODES` in `src/lib/session-store.ts`, unit-tested
// there next to the wipe policy). Rust only transports the verdict code.
// Same split for offline backoff: the retry loop runs in JS.

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
    let raw = serde_json::to_vec(data).map_err(std::io::Error::other)?;
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
    load_from_disk_for(app_dir, KEYRING_SERVICE, KEYRING_ACCOUNT)
}

fn load_from_disk_for(app_dir: &Path, service: &str, account: &str) -> (SessionData, bool) {
    match keyring::Entry::new(service, account).and_then(|e| e.get_password()) {
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

fn save_to_disk_for(app_dir: &Path, data: &SessionData, service: &str, account: &str) {
    let raw = serde_json::to_string(data).unwrap_or_default();
    match keyring::Entry::new(service, account).and_then(|e| e.set_password(&raw)) {
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

fn clear_disk_for(app_dir: &Path, service: &str, account: &str) {
    if let Ok(entry) = keyring::Entry::new(service, account) {
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
    keyring_service: String,
    keyring_account: String,
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
            keyring_service: KEYRING_SERVICE.to_string(),
            keyring_account: KEYRING_ACCOUNT.to_string(),
        }
    }

    /// Point the file fallback at the real app data dir + reload disk state.
    /// Called once from `setup`; after this the memory snapshot is authoritative.
    pub fn init_app_dir(&self, dir: PathBuf) {
        if let Ok(mut slot) = self.app_dir.lock() {
            *slot = dir.clone();
        }
        let (data, _) = load_from_disk_for(&dir, &self.keyring_service, &self.keyring_account);
        if !data.is_empty() {
            if let Ok(mut g) = self.mem.lock() {
                *g = data;
            }
        }
    }

    fn dir(&self) -> PathBuf {
        self.app_dir
            .lock()
            .map(|g| g.clone())
            .unwrap_or_else(|_| std::env::temp_dir())
    }

    pub fn snapshot(&self) -> SessionData {
        self.mem.lock().map(|g| g.clone()).unwrap_or_default()
    }

    pub fn store(&self, data: SessionData) {
        if let Ok(mut g) = self.mem.lock() {
            *g = data.clone();
        }
        save_to_disk_for(
            &self.dir(),
            &data,
            &self.keyring_service,
            &self.keyring_account,
        );
    }

    pub fn clear(&self) {
        if let Ok(mut g) = self.mem.lock() {
            *g = SessionData::default();
        }
        clear_disk_for(&self.dir(), &self.keyring_service, &self.keyring_account);
    }

    /// Refresh the pair. `expected_access` is the caller's current access
    /// token: if memory already holds something else, another instance won
    /// the race — adopt it without spending the refresh token.
    pub async fn refresh(
        &self,
        base_url: &str,
        expected_access: Option<String>,
    ) -> Result<String, String> {
        // Validate before reading or adopting any token, including direct calls.
        let url = auth_endpoint(base_url, "refresh")?;
        let _guard = self.refresh_lock.lock().await;

        let current = self.snapshot();
        if should_reuse_stored(current.access_token.as_deref(), expected_access.as_deref()) {
            return current.access_token.ok_or_else(|| "NO_SESSION".to_string());
        }
        let refresh_token = current
            .refresh_token
            .ok_or_else(|| "NO_REFRESH_TOKEN".to_string())?;

        let client = reqwest::Client::builder()
            .timeout(Duration::from_secs(10))
            .redirect(reqwest::redirect::Policy::none())
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
        let payload: serde_json::Value =
            serde_json::from_str(&text).unwrap_or(serde_json::Value::Null);
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
    pub async fn logout(&self, base_url: &str) -> Result<(), String> {
        // Wait for a rotation to persist before revoking/clearing the latest pair.
        let _guard = self.refresh_lock.lock().await;
        let destination = auth_endpoint(base_url, "logout");
        if let (Ok(url), Some(rt)) = (&destination, self.snapshot().refresh_token) {
            if let Ok(client) = reqwest::Client::builder()
                .timeout(Duration::from_secs(10))
                .redirect(reqwest::redirect::Policy::none())
                .build()
            {
                let _ = client
                    .post(url.clone())
                    .json(&serde_json::json!({ "refreshToken": rt }))
                    .send()
                    .await;
            }
        }
        self.clear();
        destination.map(|_| ())
    }
}

#[tauri::command]
pub async fn auth_logout(
    store: tauri::State<'_, SessionStore>,
    base_url: String,
) -> Result<(), String> {
    store.logout(&base_url).await
}

#[tauri::command]
pub async fn auth_refresh(
    store: tauri::State<'_, SessionStore>,
    base_url: String,
    expected_access: Option<String>,
) -> Result<String, String> {
    auth_endpoint(&base_url, "refresh")?;
    store.refresh(&base_url, expected_access).await
}

#[cfg(test)]
mod tests {
    use super::*;

    struct SessionFixture {
        dir: PathBuf,
        service: String,
        account: String,
    }

    impl SessionFixture {
        fn new() -> Self {
            let nonce = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos();
            let id = format!("{}-{nonce}", std::process::id());
            let dir = std::env::temp_dir().join(format!("bw-tauri-session-fixture-{id}"));
            std::fs::create_dir(&dir).unwrap();
            Self {
                dir,
                service: format!("uz.bestway.exam.test.{id}"),
                account: "synthetic-session".to_string(),
            }
        }

        fn store(&self, data: SessionData) -> SessionStore {
            // Never construct SessionStore::new in tests: it reads the student's
            // real credential. Every persistence/cleanup operation stays scoped
            // to this synthetic service, account and freshly created directory.
            SessionStore {
                mem: StdMutex::new(data),
                refresh_lock: tauri::async_runtime::Mutex::new(()),
                app_dir: StdMutex::new(self.dir.clone()),
                keyring_service: self.service.clone(),
                keyring_account: self.account.clone(),
            }
        }
    }

    impl Drop for SessionFixture {
        fn drop(&mut self) {
            clear_disk_for(&self.dir, &self.service, &self.account);
            let _ = std::fs::remove_file(self.dir.join("session.json.tmp"));
            // Nonrecursive removal cannot delete unrelated fixture contents.
            let _ = std::fs::remove_dir(&self.dir);
        }
    }

    fn synthetic_session() -> SessionData {
        SessionData {
            access_token: Some("synthetic-access".into()),
            refresh_token: Some("synthetic-refresh".into()),
            device_id: Some("synthetic-device".into()),
            profile_json: Some("{}".into()),
        }
    }

    #[test]
    fn configured_backend_has_persistent_credentials() {
        assert!(
            !matches!(
                keyring::default::default_credential_builder().persistence(),
                keyring::credential::CredentialPersistence::EntryOnly
            ),
            "desktop builds must not select the nonpersistent mock credential backend"
        );
    }

    // Windows Credential Manager is available on native CI/local Windows.
    // Headless Linux CI has no running/unlocked Secret Service; its backend
    // selection is covered above without touching the user's real credentials.
    #[cfg(target_os = "windows")]
    #[test]
    fn native_session_survives_new_credential_entry_and_load() {
        let fixture = SessionFixture::new();
        assert!(matches!(
            keyring::Entry::new(&fixture.service, &fixture.account)
                .unwrap()
                .get_password(),
            Err(keyring::Error::NoEntry)
        ));
        let data = synthetic_session();
        write_file_store(&fixture.dir, &data).unwrap();
        let store = fixture.store(SessionData::default());
        store.store(data.clone());
        assert!(
            !session_file(&fixture.dir).exists(),
            "native write must replace the fallback"
        );
        let fresh_entry = keyring::Entry::new(&fixture.service, &fixture.account).unwrap();
        let saved: SessionData =
            serde_json::from_str(&fresh_entry.get_password().unwrap()).unwrap();
        assert_eq!(saved, data);
        assert_eq!(
            load_from_disk_for(&fixture.dir, &fixture.service, &fixture.account),
            (data, false)
        );
    }

    #[test]
    fn auth_urls_match_configured_origin_port_and_api_path() {
        let configured = "https://staging-api.example.test:8443/api/v2";
        assert_eq!(
            auth_endpoint_for(
                "https://STAGING-API.example.test:8443/api/v2/",
                "refresh",
                configured,
                false
            )
            .unwrap()
            .as_str(),
            "https://staging-api.example.test:8443/api/v2/auth/refresh"
        );
        assert_eq!(
            auth_endpoint_for(
                "https://api.bestwayec.uz:443/v1",
                "logout",
                DEFAULT_API_BASE_URL,
                false
            )
            .unwrap()
            .as_str(),
            "https://api.bestwayec.uz/v1/auth/logout"
        );
        for wrong in [
            "https://staging-api.example.test/api/v2",
            "https://staging-api.example.test:8443/api/v1",
            "https://other.example.test:8443/api/v2",
        ] {
            assert!(auth_endpoint_for(wrong, "refresh", configured, false).is_err());
        }
    }

    #[test]
    fn plaintext_loopback_auth_is_development_only() {
        for local in [
            "http://localhost:3001/v1",
            "http://127.0.0.1:3001/v1",
            "http://[::1]:3001/v1",
        ] {
            assert!(auth_endpoint_for(local, "refresh", DEFAULT_API_BASE_URL, true).is_ok());
            assert!(auth_endpoint_for(local, "refresh", DEFAULT_API_BASE_URL, false).is_err());
            assert!(auth_endpoint_for(local, "refresh", local, false).is_err());
        }
    }

    #[test]
    fn auth_urls_reject_untrusted_and_ambiguous_destinations() {
        for rejected in [
            "http://api.bestwayec.uz/v1",
            "https://evil.example/v1",
            "https://api.bestwayec.uz.evil.example/v1",
            "https://api.bestwayec.uz@evil.example/v1",
            "https://user@api.bestwayec.uz/v1",
            "https://api.bestwayec.uz/v1?next=evil",
            "https://api.bestwayec.uz/v1#fragment",
            "https://api.bestwayec.uz/v1/../other",
            "https://api.bestwayec.uz/v1\n",
            "javascript:alert(1)",
            "file:///v1",
        ] {
            assert!(
                auth_endpoint_for(rejected, "refresh", DEFAULT_API_BASE_URL, true).is_err(),
                "accepted {rejected}"
            );
            assert!(
                auth_endpoint_for(rejected, "logout", DEFAULT_API_BASE_URL, true).is_err(),
                "accepted {rejected}"
            );
        }
    }

    #[test]
    fn refresh_rejects_untrusted_destination_before_reusing_stored_token() {
        let fixture = SessionFixture::new();
        let store = fixture.store(synthetic_session());
        let error = tauri::async_runtime::block_on(
            store.refresh("https://evil.example/v1", Some("old-token".into())),
        )
        .unwrap_err();
        assert!(error.starts_with("UNSAFE_URL:"));
        assert_eq!(store.snapshot(), synthetic_session());
    }

    #[test]
    fn rejected_logout_clears_only_the_synthetic_local_session_without_sending() {
        let fixture = SessionFixture::new();
        let store = fixture.store(synthetic_session());
        write_file_store(&fixture.dir, &synthetic_session()).unwrap();
        let error =
            tauri::async_runtime::block_on(store.logout("https://evil.example/v1")).unwrap_err();
        assert!(error.starts_with("UNSAFE_URL:"));
        assert!(store.snapshot().is_empty());
        assert!(!session_file(&fixture.dir).exists());
    }

    #[test]
    fn logout_waits_for_refresh_rotation_before_clearing() {
        use std::future::Future;
        use std::sync::Arc;
        use std::task::{Context, Poll, Wake, Waker};

        struct NoopWake;
        impl Wake for NoopWake {
            fn wake(self: Arc<Self>) {}
        }

        let fixture = SessionFixture::new();
        let store = fixture.store(synthetic_session());
        tauri::async_runtime::block_on(async {
            let rotating = store.refresh_lock.lock().await;
            let mut logout = Box::pin(store.logout("https://evil.example/v1"));
            let waker = Waker::from(Arc::new(NoopWake));
            let mut context = Context::from_waker(&waker);
            assert!(logout.as_mut().poll(&mut context).is_pending());
            assert_eq!(store.snapshot(), synthetic_session());
            drop(rotating);
            assert!(
                matches!(logout.as_mut().poll(&mut context), Poll::Ready(Err(error)) if error.starts_with("UNSAFE_URL:"))
            );
            assert!(store.snapshot().is_empty());
        });
    }

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
        let fixture = SessionFixture::new();
        let dir = &fixture.dir;
        let data = SessionData {
            access_token: Some("a".into()),
            refresh_token: Some("r".into()),
            device_id: Some("d".into()),
            profile_json: Some("{}".into()),
        };
        write_file_store(dir, &data).unwrap();
        assert_eq!(read_file_store(dir), Some(data));
        assert!(
            !session_file(&dir).with_extension("tmp").exists()
                && !dir.join("session.json.tmp").exists()
        );
        remove_file_store(dir);
        assert_eq!(read_file_store(dir), None);
    }
}
