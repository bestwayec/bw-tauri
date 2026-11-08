//! Existence check for the manual-installer fallback of the update toast.
//!
//! The webview cannot read the status of a cross-origin HEAD request (GitHub
//! release downloads and the website media folder send no CORS headers), so
//! the toast asks the native side whether the installer URL really serves a
//! file before it offers "Download & update". A 404 there means the toast is
//! not shown at all.
//!
//! Only HTTPS URLs on the release hosts below are probed, so the command can
//! never be used to reach arbitrary or internal addresses.

use std::time::Duration;

/// Hosts that serve published desktop installers. Redirect targets (GitHub's
/// asset CDN) are followed by the HTTP client and need not be listed.
const ALLOWED_HOSTS: &[&str] = &["github.com", "bestwayec.uz", "www.bestwayec.uz", "api.bestwayec.uz"];

const PROBE_TIMEOUT: Duration = Duration::from_secs(8);

/// True when `raw` is an HTTPS URL on an allowed release host, without
/// credentials, control characters, or a non-default port.
pub fn probe_url_allowed(raw: &str) -> bool {
    let s = raw.trim();
    if s.is_empty() || s.chars().any(|c| c.is_control()) {
        return false;
    }
    let Ok(parsed) = url::Url::parse(s) else {
        return false;
    };
    if parsed.scheme() != "https"
        || !parsed.username().is_empty()
        || parsed.password().is_some()
        || parsed.port().is_some()
    {
        return false;
    }
    let host = parsed.host_str().unwrap_or_default().to_ascii_lowercase();
    ALLOWED_HOSTS.contains(&host.as_str())
}

/// HEAD the installer URL (falling back to a one-byte ranged GET for servers
/// that reject HEAD). Resolves `true` only for a 2xx final response.
#[tauri::command]
pub async fn probe_download_url(url: String) -> Result<bool, String> {
    if !probe_url_allowed(&url) {
        return Err("URL is not an allowed release download".to_string());
    }
    let client = reqwest::Client::builder()
        .timeout(PROBE_TIMEOUT)
        .redirect(reqwest::redirect::Policy::limited(5))
        .https_only(true)
        .build()
        .map_err(|e| e.to_string())?;
    match client.head(url.trim()).send().await {
        Ok(resp) if resp.status().is_success() => return Ok(true),
        Ok(resp) if resp.status() != reqwest::StatusCode::METHOD_NOT_ALLOWED => return Ok(false),
        Ok(_) => {}
        Err(e) => return Err(e.to_string()),
    }
    let resp = client
        .get(url.trim())
        .header(reqwest::header::RANGE, "bytes=0-0")
        .send()
        .await
        .map_err(|e| e.to_string())?;
    Ok(resp.status().is_success())
}

#[cfg(test)]
mod tests {
    use super::probe_url_allowed;

    #[test]
    fn allows_release_hosts_over_https() {
        assert!(probe_url_allowed(
            "https://github.com/bestwayec/bw-tauri/releases/download/v1.0.10/Bestway.App_1.0.10_x64-setup.exe"
        ));
        assert!(probe_url_allowed("https://bestwayec.uz/media/downloads/Bestway.App_1.0.10_x64-setup.exe"));
    }

    #[test]
    fn rejects_everything_else() {
        for url in [
            "",
            "http://github.com/x.exe",
            "https://evil.test/x.exe",
            "https://github.com.evil.test/x.exe",
            "https://user:pass@github.com/x.exe",
            "https://github.com:8443/x.exe",
            "https://127.0.0.1/x.exe",
            "file:///C:/x.exe",
            "javascript:alert(1)",
            "https://github.com/x\n.exe",
        ] {
            assert!(!probe_url_allowed(url), "{url} must be rejected");
        }
    }
}
