//! System-browser opener for desktop OAuth login (fallback path).
//!
//! The frontend first tries the `opener` plugin (`openUrl`), which is gated
//! by the `opener:allow-open-url` capability scope. If that call ever fails
//! (scope denial, missing permission), this app-owned command opens the URL
//! with the OS default browser directly, bypassing the plugin gate.
//!
//! It enforces its OWN strict allowlist, so it can never become an open
//! redirect:
//! - `https://bestwayec.uz/*`, `https://api.bestwayec.uz/*` (production)
//! - `http://localhost:*` / `http://127.0.0.1:*` / `http://[::1]*` (local dev)
//! Anything else — including `javascript:`, `data:`, `file:`, userinfo URLs
//! (`https://user:pass@host`), or unparseable input — is rejected BEFORE
//! touching the OS.

use tauri_plugin_opener::OpenerExt;

/// Exact HTTPS hosts the desktop login flow may open. No subdomains.
const ALLOWED_HTTPS_HOSTS: &[&str] = &["bestwayec.uz", "api.bestwayec.uz"];

/// Loopback hosts allowed over cleartext HTTP (dev only).
fn is_loopback(host: &str) -> bool {
    matches!(host, "localhost" | "127.0.0.1" | "::1")
}

fn url_allowed(raw: &str) -> bool {
    let s = raw.trim();
    if s.is_empty() {
        return false;
    }
    // Reject control characters outright (header/request smuggling hygiene).
    if s.chars().any(|c| c.is_control()) {
        return false;
    }
    let lower = s.to_ascii_lowercase();
    for bad in [
        "javascript:",
        "data:",
        "file:",
        "vbscript:",
        "blob:",
        "mailto:",
        "tel:",
    ] {
        if lower.starts_with(bad) {
            return false;
        }
    }
    let parsed: url::Url = match s.parse() {
        Ok(u) => u,
        Err(_) => return false,
    };
    // Credentials in the URL are never legitimate here.
    if !parsed.username().is_empty() || parsed.password().is_some() {
        return false;
    }
    let host = parsed.host_str().unwrap_or_default().to_ascii_lowercase();
    match parsed.scheme() {
        "https" => ALLOWED_HTTPS_HOSTS.contains(&host.as_str()),
        "http" => is_loopback(&host),
        _ => false,
    }
}

/// Open a login URL in the OS default browser (no app selection).
#[tauri::command]
pub fn open_system_browser(app: tauri::AppHandle, url: String) -> Result<(), String> {
    if !url_allowed(&url) {
        return Err("UNSAFE_URL: refusing to open a URL outside the login allowlist".to_string());
    }
    app.opener()
        .open_url(url, None::<&str>)
        .map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn allows_prod_authorize_url() {
        assert!(url_allowed(
            "https://bestwayec.uz/oauth/desktop?device=abc&state=def&code_challenge=ghi&code_challenge_method=S256&redirect=bestway-exam%3A%2F%2Fauth%2Fcallback"
        ));
        assert!(url_allowed("https://api.bestwayec.uz/v1/auth/me"));
    }

    #[test]
    fn allows_loopback_dev() {
        assert!(url_allowed("http://localhost:3005/oauth/desktop?device=x"));
        assert!(url_allowed("http://127.0.0.1:3005/"));
    }

    #[test]
    fn rejects_everything_else() {
        // Wrong hosts / schemes.
        assert!(!url_allowed("https://evil.com/oauth/desktop"));
        assert!(!url_allowed("https://bestwayec.uz.evil.com/"));
        assert!(!url_allowed("https://evibestwayec.uz/"));
        assert!(!url_allowed("http://bestwayec.uz/")); // prod must be https
        assert!(!url_allowed("http://192.168.1.5:3005/")); // LAN IP is not loopback
        // Dangerous schemes.
        assert!(!url_allowed("javascript:alert(1)"));
        assert!(!url_allowed("data:text/html,hi"));
        assert!(!url_allowed("file:///etc/passwd"));
        // Credentials smuggling.
        assert!(!url_allowed("https://user:pass@bestwayec.uz/"));
        // Garbage.
        assert!(!url_allowed(""));
        assert!(!url_allowed("   "));
        assert!(!url_allowed("not a url"));
        assert!(!url_allowed("https://bestwayec.uz/\nSet-Cookie: x"));
    }
}
