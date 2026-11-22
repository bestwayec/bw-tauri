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
//! Storage: tokens are persisted ONLY in the OS credential store (`keyring`:
//! Windows Credential Manager / macOS Keychain / Secret Service), and only
//! after a fresh-handle read-back proves the store returns them. When no
//! protected store is usable (headless Linux, locked keyring, policy), the
//! session is kept in memory only (`Persistence::MemoryOnly`): the user stays
//! signed in until the app exits and signs in again on the next launch. No
//! token is ever written to a file. A `session.json` left by builds up to
//! 1.0.12 (plaintext file fallback) is migrated into the protected store when
//! possible and deleted in every case. Tokens are never logged.

use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
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

/// The webview may use access tokens, but never reads persisted refresh tokens.
#[derive(Serialize)]
pub struct SessionSnapshot {
    access_token: Option<String>,
    device_id: Option<String>,
    profile_json: Option<String>,
    /// `memory_only` tells the UI that this session ends when the app exits.
    persistence: Persistence,
}

impl SessionSnapshot {
    fn new(data: SessionData, persistence: Persistence) -> Self {
        Self {
            access_token: data.access_token,
            device_id: data.device_id,
            profile_json: data.profile_json,
            persistence,
        }
    }
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
// Protected storage: OS credential store only; legacy plaintext file scrubbing
// ---------------------------------------------------------------------------

/// Where the current session survives a restart.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum Persistence {
    /// Stored in the OS credential store and verified by read-back.
    Native,
    /// No usable protected store: kept in process memory only.
    MemoryOnly,
}

/// The secret slot holding the serialized session. Implemented by the OS
/// keyring in production; tests inject deterministic stores.
pub(crate) trait SecretStore: Send + Sync {
    fn set(&self, secret: &str) -> Result<(), String>;
    /// `Ok(None)` means "no entry"; `Err` means the store itself is unusable.
    fn get(&self) -> Result<Option<String>, String>;
    fn delete(&self);
}

pub(crate) struct KeyringSecret {
    service: String,
    account: String,
}

impl KeyringSecret {
    pub(crate) fn new(service: &str, account: &str) -> Self {
        Self {
            service: service.to_string(),
            account: account.to_string(),
        }
    }

    fn entry(&self) -> keyring::Result<keyring::Entry> {
        keyring::Entry::new(&self.service, &self.account)
    }
}

impl SecretStore for KeyringSecret {
    fn set(&self, secret: &str) -> Result<(), String> {
        // keyring errors describe the platform failure, never the secret.
        self.entry()
            .and_then(|entry| entry.set_password(secret))
            .map_err(|e| e.to_string())
    }

    fn get(&self) -> Result<Option<String>, String> {
        // A fresh handle per read, exactly as the next launch would see it.
        match self.entry().and_then(|entry| entry.get_password()) {
            Ok(secret) => Ok(Some(secret)),
            Err(keyring::Error::NoEntry) => Ok(None),
            Err(e) => Err(e.to_string()),
        }
    }

    fn delete(&self) {
        if let Ok(entry) = self.entry() {
            let _ = entry.delete_credential();
        }
    }
}

/// Plaintext session file written by desktop builds up to 1.0.12.
fn legacy_session_file(dir: &Path) -> PathBuf {
    dir.join(SESSION_FILE)
}

fn read_legacy_file(dir: &Path) -> Option<SessionData> {
    let raw = std::fs::read(legacy_session_file(dir)).ok()?;
    serde_json::from_slice(&raw).ok()
}

/// Deletes the legacy plaintext file and any interrupted temp copy. Returns
/// false only when a file exists and could not be removed.
fn scrub_legacy_files(dir: &Path) -> bool {
    let mut removed = true;
    for path in [
        legacy_session_file(dir),
        dir.join(format!("{SESSION_FILE}.tmp")),
    ] {
        match std::fs::remove_file(&path) {
            Ok(()) => {}
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
            Err(e) => {
                eprintln!("[session] could not remove legacy session file: {}", e.kind());
                removed = false;
            }
        }
    }
    removed
}

/// Writes the session to the protected store and proves a fresh read returns
/// it. Anything less is treated as unavailable: the partial secret is removed
/// and the caller keeps the session in memory only. Never touches the disk.
fn persist_protected(secrets: &dyn SecretStore, data: &SessionData) -> Persistence {
    let Ok(raw) = serde_json::to_string(data) else {
        return Persistence::MemoryOnly;
    };
    let verified = match secrets.set(&raw) {
        Ok(()) => match secrets.get() {
            Ok(Some(stored)) if stored == raw => true,
            Ok(_) => {
                eprintln!("[session] credential store did not return the written session; memory-only");
                false
            }
            Err(e) => {
                eprintln!("[session] credential store read-back failed; memory-only: {e}");
                false
            }
        },
        Err(e) => {
            eprintln!("[session] protected credential store unavailable; memory-only: {e}");
            false
        }
    };
    if verified {
        Persistence::Native
    } else {
        secrets.delete();
        Persistence::MemoryOnly
    }
}

/// Startup load. Protected store first; otherwise migrate a legacy plaintext
/// session (kept for this run even if migration fails, so an upgrade never
/// logs the user out mid-session). The legacy file is removed in every case.
fn load_session(secrets: &dyn SecretStore, dir: &Path) -> (SessionData, Persistence) {
    let legacy = read_legacy_file(dir);
    let mut store_usable = true;
    match secrets.get() {
        Ok(Some(raw)) => match serde_json::from_str::<SessionData>(&raw) {
            Ok(data) => {
                scrub_legacy_files(dir);
                return (data, Persistence::Native);
            }
            Err(_) => {
                eprintln!("[session] protected session payload unreadable; discarding it");
                secrets.delete();
            }
        },
        Ok(None) => {}
        Err(e) => {
            eprintln!("[session] protected credential store unavailable: {e}");
            store_usable = false;
        }
    }
    let result = match legacy.filter(|data| !data.is_empty()) {
        Some(data) => {
            let mode = persist_protected(secrets, &data);
            (data, mode)
        }
        None if store_usable => (SessionData::default(), Persistence::Native),
        None => (SessionData::default(), Persistence::MemoryOnly),
    };
    scrub_legacy_files(dir);
    result
}

// ---------------------------------------------------------------------------
// Managed state + refresh ownership
// ---------------------------------------------------------------------------

pub struct SessionStore {
    mem: StdMutex<SessionData>,
    generation: AtomicU64,
    /// Serializes refresh: exactly one POST /auth/refresh at a time.
    refresh_lock: tauri::async_runtime::Mutex<()>,
    /// Resolved in `setup` (needs the app handle); only used to find and
    /// remove a legacy plaintext session file.
    app_dir: StdMutex<PathBuf>,
    secrets: Box<dyn SecretStore>,
    persistence: StdMutex<Persistence>,
}

impl Default for SessionStore {
    fn default() -> Self {
        Self::new()
    }
}

impl SessionStore {
    pub fn new() -> Self {
        Self::with_secrets(
            Box::new(KeyringSecret::new(KEYRING_SERVICE, KEYRING_ACCOUNT)),
            // Never read a shared temporary directory before app setup.
            std::env::temp_dir(),
        )
    }

    pub(crate) fn with_secrets(secrets: Box<dyn SecretStore>, app_dir: PathBuf) -> Self {
        Self {
            mem: StdMutex::new(SessionData::default()),
            generation: AtomicU64::new(0),
            refresh_lock: tauri::async_runtime::Mutex::new(()),
            app_dir: StdMutex::new(app_dir),
            secrets,
            persistence: StdMutex::new(Persistence::Native),
        }
    }

    /// Point at the real app data dir and restore the protected session.
    /// Called once from `setup`; after this the memory snapshot is authoritative.
    pub fn init_app_dir(&self, dir: PathBuf) {
        if let Ok(mut slot) = self.app_dir.lock() {
            *slot = dir.clone();
        }
        let (data, mode) = load_session(self.secrets.as_ref(), &dir);
        self.set_persistence(mode);
        if !data.is_empty() {
            if let Ok(mut g) = self.mem.lock() {
                *g = data;
            }
        }
    }

    pub fn persistence(&self) -> Persistence {
        self.persistence
            .lock()
            .map(|g| *g)
            .unwrap_or(Persistence::MemoryOnly)
    }

    fn set_persistence(&self, mode: Persistence) {
        if let Ok(mut slot) = self.persistence.lock() {
            *slot = mode;
        }
    }

    /// Persists `data` (already in memory) to the protected store. Memory-only
    /// is not an error: the session works until exit, and the UI is told.
    fn persist(&self, data: &SessionData) -> Result<(), String> {
        let mode = persist_protected(self.secrets.as_ref(), data);
        self.set_persistence(mode);
        Ok(())
    }

    pub fn snapshot(&self) -> SessionData {
        self.mem.lock().map(|g| g.clone()).unwrap_or_default()
    }

    #[cfg(test)]
    pub fn store(&self, data: SessionData) -> Result<(), String> {
        self.store_session(data, false)
    }

    fn store_session(&self, mut data: SessionData, preserve_refresh: bool) -> Result<(), String> {
        let mut current = self.mem.lock().map_err(|_| "SESSION_STORE_UNAVAILABLE")?;
        if preserve_refresh {
            data.refresh_token = current.refresh_token.clone();
        }
        self.generation.fetch_add(1, Ordering::SeqCst);
        *current = data;
        self.persist(&current)
    }

    fn store_if_current(&self, data: SessionData, expected_generation: u64) -> Result<(), String> {
        let mut current = self.mem.lock().map_err(|_| "SESSION_STORE_UNAVAILABLE")?;
        if self.generation.load(Ordering::SeqCst) != expected_generation {
            return Err("SESSION_CHANGED".into());
        }
        self.generation.fetch_add(1, Ordering::SeqCst);
        *current = data;
        self.persist(&current)
    }

    pub fn update_profile(&self, profile_json: Option<String>) -> Result<(), String> {
        let mut current = self.mem.lock().map_err(|_| "SESSION_STORE_UNAVAILABLE")?;
        current.profile_json = profile_json;
        self.persist(&current)
    }

    pub fn clear(&self) {
        if let Ok(mut current) = self.mem.lock() {
            self.generation.fetch_add(1, Ordering::SeqCst);
            *current = SessionData::default();
            self.secrets.delete();
            let dir = self
                .app_dir
                .lock()
                .map(|g| g.clone())
                .unwrap_or_else(|_| std::env::temp_dir());
            scrub_legacy_files(&dir);
        }
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

        let (current, generation) = {
            let current = self.mem.lock().map_err(|_| "SESSION_STORE_UNAVAILABLE")?;
            (current.clone(), self.generation.load(Ordering::SeqCst))
        };
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
        self.store_if_current(next, generation)?;
        Ok(access.to_string())
    }
}

// ---------------------------------------------------------------------------
// Tauri commands (least-privilege: no extra capabilities needed — the app's
// own commands are invokable from its main window like the existing ones)
// ---------------------------------------------------------------------------

#[tauri::command]
pub fn session_get(store: tauri::State<'_, SessionStore>) -> SessionSnapshot {
    SessionSnapshot::new(store.snapshot(), store.persistence())
}

#[tauri::command]
pub fn session_set(
    store: tauri::State<'_, SessionStore>,
    data: SessionData,
    preserve_refresh: Option<bool>,
) -> Result<Persistence, String> {
    store.store_session(data, preserve_refresh.unwrap_or(false))?;
    Ok(store.persistence())
}

#[tauri::command]
pub fn session_update_profile(
    store: tauri::State<'_, SessionStore>,
    profile_json: Option<String>,
) -> Result<(), String> {
    store.update_profile(profile_json)
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
        let destination = auth_endpoint(base_url, "logout-refresh");
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
        // Every fixture-backed store writes through the real OS credential
        // store on Windows/macOS; keyring backends document undefined results
        // under concurrent access, so fixtures run one at a time. Declared last
        // so it is released only after `Drop` has cleaned the credential.
        _native: std::sync::MutexGuard<'static, ()>,
    }

    impl SessionFixture {
        fn new() -> Self {
            let native = crate::test_support::native_credential_lock();
            // Parallel test threads can read the same coarse wall-clock value;
            // the process-wide sequence guarantees a distinct credential target
            // and directory per fixture, so one test's cleanup can never delete
            // another test's synthetic credential.
            static SEQUENCE: AtomicU64 = AtomicU64::new(0);
            let sequence = SEQUENCE.fetch_add(1, Ordering::SeqCst);
            let nonce = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos();
            let id = format!("{}-{sequence}-{nonce}", std::process::id());
            let dir = std::env::temp_dir().join(format!("bw-tauri-session-fixture-{id}"));
            std::fs::create_dir(&dir).unwrap();
            Self {
                dir,
                service: format!("uz.bestway.exam.test.{id}"),
                account: "synthetic-session".to_string(),
                _native: native,
            }
        }

        /// Store backed by a deterministic in-process secret slot.
        fn store(&self, data: SessionData) -> SessionStore {
            self.store_with(Box::new(MemorySecret::default()), data)
        }

        /// Never construct SessionStore::new in tests: it reads the student's
        /// real credential. Every operation stays scoped to this fixture.
        fn store_with(&self, secrets: Box<dyn SecretStore>, data: SessionData) -> SessionStore {
            let store = SessionStore::with_secrets(secrets, self.dir.clone());
            *store.mem.lock().unwrap() = data;
            store
        }

        /// The real OS keyring, under a synthetic service unique to this fixture.
        fn native(&self) -> KeyringSecret {
            KeyringSecret::new(&self.service, &self.account)
        }

        /// What builds up to 1.0.12 wrote when the keyring was unavailable.
        fn write_legacy(&self, data: &SessionData) {
            std::fs::write(
                legacy_session_file(&self.dir),
                serde_json::to_vec(data).unwrap(),
            )
            .unwrap();
        }

        fn legacy_exists(&self) -> bool {
            legacy_session_file(&self.dir).exists()
                || self.dir.join("session.json.tmp").exists()
        }
    }

    impl Drop for SessionFixture {
        fn drop(&mut self) {
            self.native().delete();
            scrub_legacy_files(&self.dir);
            // Nonrecursive removal cannot delete unrelated fixture contents.
            let _ = std::fs::remove_dir(&self.dir);
        }
    }

    /// Working protected store, shareable between "launches".
    #[derive(Default, Clone)]
    struct MemorySecret(std::sync::Arc<StdMutex<Option<String>>>);

    impl SecretStore for MemorySecret {
        fn set(&self, secret: &str) -> Result<(), String> {
            *self.0.lock().unwrap() = Some(secret.to_string());
            Ok(())
        }
        fn get(&self) -> Result<Option<String>, String> {
            Ok(self.0.lock().unwrap().clone())
        }
        fn delete(&self) {
            *self.0.lock().unwrap() = None;
        }
    }

    /// No protected store (headless Linux, locked keyring, policy).
    struct UnavailableSecret;

    impl SecretStore for UnavailableSecret {
        fn set(&self, _: &str) -> Result<(), String> {
            Err("Platform secure storage failure".into())
        }
        fn get(&self) -> Result<Option<String>, String> {
            Err("Platform secure storage failure".into())
        }
        fn delete(&self) {}
    }

    /// Acknowledges writes but never returns them (volatile logon session).
    struct VolatileSecret;

    impl SecretStore for VolatileSecret {
        fn set(&self, _: &str) -> Result<(), String> {
            Ok(())
        }
        fn get(&self) -> Result<Option<String>, String> {
            Ok(None)
        }
        fn delete(&self) {}
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
        // Upgrade path: a 1.0.12 plaintext file is migrated, then deleted.
        fixture.write_legacy(&data);
        let store = fixture.store_with(Box::new(fixture.native()), SessionData::default());
        store.init_app_dir(fixture.dir.clone());
        assert_eq!(store.snapshot(), data);
        assert_eq!(store.persistence(), Persistence::Native);
        assert!(!fixture.legacy_exists(), "plaintext file must be removed");
        let mut rotated = data.clone();
        rotated.refresh_token = Some("synthetic-rotated".into());
        store.store(rotated.clone()).unwrap();
        let data = rotated;
        let fresh_entry = keyring::Entry::new(&fixture.service, &fixture.account).unwrap();
        let raw = fresh_entry
            .get_password()
            .unwrap_or_else(|e| panic!("native credential not readable by a fresh entry: {e:?}"));
        let saved: SessionData = serde_json::from_str(&raw).unwrap();
        assert_eq!(saved, data);
        // A new process restores the rotated pair from the native store.
        assert_eq!(
            load_session(&fixture.native(), &fixture.dir),
            (data, Persistence::Native)
        );
        assert!(!fixture.legacy_exists());
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
        let secret = MemorySecret::default();
        let store = fixture.store_with(Box::new(secret.clone()), SessionData::default());
        store.store(synthetic_session()).unwrap();
        fixture.write_legacy(&synthetic_session());
        let error =
            tauri::async_runtime::block_on(store.logout("https://evil.example/v1")).unwrap_err();
        assert!(error.starts_with("UNSAFE_URL:"));
        assert!(store.snapshot().is_empty());
        assert_eq!(secret.get().unwrap(), None);
        assert!(!fixture.legacy_exists());
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
    fn webview_snapshot_does_not_expose_refresh_tokens() {
        let snapshot = serde_json::to_value(SessionSnapshot::new(
            synthetic_session(),
            Persistence::MemoryOnly,
        ))
        .unwrap();
        assert!(snapshot.get("refresh_token").is_none());
        assert!(!snapshot.to_string().contains("synthetic-refresh"));
        assert_eq!(snapshot["persistence"], "memory_only");
        assert_eq!(snapshot["access_token"], "synthetic-access");
    }

    #[test]
    fn session_updates_preserve_refresh_only_when_explicitly_requested() {
        let fixture = SessionFixture::new();
        let store = fixture.store(synthetic_session());
        let mut update = synthetic_session();
        update.refresh_token = None;
        store.store_session(update.clone(), true).unwrap();
        assert_eq!(
            store.snapshot().refresh_token,
            synthetic_session().refresh_token
        );
        store.store_session(update, false).unwrap();
        assert!(store.snapshot().refresh_token.is_none());
    }

    #[test]
    fn late_refresh_cannot_restore_a_cleared_or_replaced_session() {
        let fixture = SessionFixture::new();
        let store = fixture.store(synthetic_session());
        let generation = store.generation.load(Ordering::SeqCst);
        store.clear();
        assert_eq!(
            store
                .store_if_current(synthetic_session(), generation)
                .unwrap_err(),
            "SESSION_CHANGED"
        );
        assert!(store.snapshot().is_empty());
        let generation = store.generation.load(Ordering::SeqCst);
        let mut replacement = synthetic_session();
        replacement.access_token = Some("new-login".into());
        store.store(replacement.clone()).unwrap();
        assert!(store
            .store_if_current(synthetic_session(), generation)
            .is_err());
        assert_eq!(store.snapshot(), replacement);
    }

    #[test]
    fn metadata_update_preserves_the_rotated_pair() {
        let fixture = SessionFixture::new();
        let store = fixture.store(synthetic_session());
        store.update_profile(Some("new-profile".into())).unwrap();
        assert_eq!(
            store.snapshot().refresh_token,
            synthetic_session().refresh_token
        );
        assert_eq!(
            store.snapshot().profile_json.as_deref(),
            Some("new-profile")
        );
    }

    #[test]
    fn reuse_when_stored_differs() {
        assert!(should_reuse_stored(Some("new"), Some("old")));
        assert!(should_reuse_stored(Some("x"), None));
        assert!(!should_reuse_stored(Some("same"), Some("same")));
        assert!(!should_reuse_stored(None, Some("old")));
        assert!(!should_reuse_stored(None, None));
    }

    fn tokens_on_disk(dir: &Path) -> bool {
        std::fs::read_dir(dir)
            .unwrap()
            .flatten()
            .any(|entry| {
                std::fs::read_to_string(entry.path())
                    .map(|text| text.contains("synthetic-refresh") || text.contains("synthetic-access"))
                    .unwrap_or(false)
            })
    }

    #[test]
    fn protected_store_restores_the_rotated_pair_after_restart() {
        let fixture = SessionFixture::new();
        let secret = MemorySecret::default();
        let first = fixture.store_with(Box::new(secret.clone()), SessionData::default());
        first.init_app_dir(fixture.dir.clone());
        first.store(synthetic_session()).unwrap();
        let generation = first.generation.load(Ordering::SeqCst);
        let mut rotated = synthetic_session();
        rotated.refresh_token = Some("synthetic-refresh-2".into());
        first.store_if_current(rotated.clone(), generation).unwrap();
        assert_eq!(first.persistence(), Persistence::Native);

        let relaunched = fixture.store_with(Box::new(secret), SessionData::default());
        relaunched.init_app_dir(fixture.dir.clone());
        assert_eq!(relaunched.snapshot(), rotated);
        assert_eq!(relaunched.persistence(), Persistence::Native);
        assert!(!tokens_on_disk(&fixture.dir));
    }

    #[test]
    fn unavailable_protected_store_keeps_tokens_in_memory_only() {
        let fixture = SessionFixture::new();
        let store = fixture.store_with(Box::new(UnavailableSecret), SessionData::default());
        store.init_app_dir(fixture.dir.clone());
        store.store(synthetic_session()).unwrap();
        assert_eq!(store.snapshot(), synthetic_session());
        assert_eq!(store.persistence(), Persistence::MemoryOnly);
        assert!(!tokens_on_disk(&fixture.dir), "no plaintext token may reach disk");
        assert!(!fixture.legacy_exists());

        let relaunched = fixture.store_with(Box::new(UnavailableSecret), SessionData::default());
        relaunched.init_app_dir(fixture.dir.clone());
        assert!(relaunched.snapshot().is_empty(), "memory-only sessions end with the process");
        assert_eq!(relaunched.persistence(), Persistence::MemoryOnly);
    }

    #[test]
    fn store_that_does_not_return_writes_is_memory_only() {
        let fixture = SessionFixture::new();
        let store = fixture.store_with(Box::new(VolatileSecret), SessionData::default());
        store.store(synthetic_session()).unwrap();
        assert_eq!(store.persistence(), Persistence::MemoryOnly);
        assert!(!tokens_on_disk(&fixture.dir));
    }

    #[test]
    fn legacy_plaintext_session_migrates_into_the_protected_store() {
        let fixture = SessionFixture::new();
        fixture.write_legacy(&synthetic_session());
        let secret = MemorySecret::default();
        let store = fixture.store_with(Box::new(secret.clone()), SessionData::default());
        store.init_app_dir(fixture.dir.clone());
        assert_eq!(store.snapshot(), synthetic_session(), "upgrade keeps the user signed in");
        assert_eq!(store.persistence(), Persistence::Native);
        assert!(!fixture.legacy_exists());
        let stored: SessionData = serde_json::from_str(&secret.get().unwrap().unwrap()).unwrap();
        assert_eq!(stored, synthetic_session());
    }

    #[test]
    fn legacy_plaintext_session_is_deleted_even_without_a_protected_store() {
        let fixture = SessionFixture::new();
        fixture.write_legacy(&synthetic_session());
        std::fs::write(fixture.dir.join("session.json.tmp"), b"{\"refresh_token\":\"synthetic-refresh\"}").unwrap();
        let store = fixture.store_with(Box::new(UnavailableSecret), SessionData::default());
        store.init_app_dir(fixture.dir.clone());
        // This run keeps working; the plaintext copy is gone for good.
        assert_eq!(store.snapshot(), synthetic_session());
        assert_eq!(store.persistence(), Persistence::MemoryOnly);
        assert!(!fixture.legacy_exists());
        assert!(!tokens_on_disk(&fixture.dir));
    }

    #[test]
    fn protected_session_wins_over_a_stale_legacy_file() {
        let fixture = SessionFixture::new();
        let secret = MemorySecret::default();
        let current = synthetic_session();
        secret.set(&serde_json::to_string(&current).unwrap()).unwrap();
        let mut stale = synthetic_session();
        stale.refresh_token = Some("stale-refresh".into());
        fixture.write_legacy(&stale);
        assert_eq!(load_session(&secret, &fixture.dir), (current, Persistence::Native));
        assert!(!fixture.legacy_exists());
    }

    #[test]
    fn corrupt_protected_payload_is_discarded_not_trusted() {
        let fixture = SessionFixture::new();
        let secret = MemorySecret::default();
        secret.set("not-json").unwrap();
        let (data, _) = load_session(&secret, &fixture.dir);
        assert!(data.is_empty());
        assert_eq!(secret.get().unwrap(), None);
    }

    #[test]
    fn account_switch_replaces_the_protected_session_entirely() {
        let fixture = SessionFixture::new();
        let secret = MemorySecret::default();
        let store = fixture.store_with(Box::new(secret.clone()), SessionData::default());
        store.store(synthetic_session()).unwrap();
        store.clear();
        assert_eq!(secret.get().unwrap(), None);
        let mut other = synthetic_session();
        other.access_token = Some("other-access".into());
        other.refresh_token = Some("other-refresh".into());
        store.store(other.clone()).unwrap();
        let stored = secret.get().unwrap().unwrap();
        assert!(!stored.contains("synthetic-refresh"));
        assert_eq!(serde_json::from_str::<SessionData>(&stored).unwrap(), other);
    }
}
