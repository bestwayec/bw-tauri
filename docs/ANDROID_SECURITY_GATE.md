# BESTWAY APPS 2.0 — ANDROID P0 SECURITY GATE REPORT

**Repository:** `bestwayec/bw-tauri`  
**Target File:** `android/app/src/main/java/uz/bestwayec/app/MainActivity.kt`  
**Pull Request:** [#36](https://github.com/bestwayec/bw-tauri/pull/36)  
**Security Level:** P0 (Highest Criticality)  
**Author:** Komiljon Roziyev (`kruziyev0@gmail.com`)  
**Status:** **PASSED & VERIFIED**  

---

## 1. Vulnerability Remediations & Technical Implementation

### Remediation 1: Elimination of Token Exposure over JavaScript Bridge
- **Vulnerability**: `AndroidBridge` exposed `@JavascriptInterface fun getRefreshToken(): String` and `@JavascriptInterface fun getAuthToken(): String`. Any JavaScript running in the WebView or injected via XSS could extract persistent refresh tokens and access tokens.
- **Fix**: Removed both `getRefreshToken()` and `getAuthToken()` entirely.
- **Posture**: `AndroidBridge` now exposes strictly environment metadata (`isMobileApp()`, `getVersion()`), and both methods verify `isTrustedOrigin(webView.url)`. No authentication tokens or credentials exist on the bridge.

### Remediation 2: Elimination of Unsafe Token Duplication & Zombie Sessions
- **Vulnerability**: Previous implementation stored tokens across four separate layers:
  1. Plaintext Android SharedPreferences (`auth_prefs.xml` on device storage).
  2. Redundant cookies (`bw_access_token`, `access_token`, `token`, `bw_refresh_token`, `refresh_token`).
  3. `onPageFinished` script injection: `localStorage.setItem('token', ...)` executed on every page navigation.
  4. `AndroidBridge` token getters.
  *Critical Bug*: When a user clicked logout on the web application, `onPageFinished` re-read the stale token from SharedPreferences and injected it back into `localStorage`, creating unbreakable zombie sessions and preventing account switching.
- **Fix**:
  - Eliminated `auth_prefs` SharedPreferences token storage.
  - Eliminated `onPageFinished` `localStorage.setItem` script injection.
  - Eliminated duplicate cookie keys.
  - Standardized on standard WebView `CookieManager` session storage matching browser security standards.
  - `handleLogout()` actively purges `CookieManager` session cookies, clears `localStorage`/`sessionStorage`, and wipes pending OAuth states.

### Remediation 3: OAuth Authorization Code + PKCE Flow with Strict State Validation
- **Vulnerability**: Unsolicited deep links could deliver arbitrary codes or tokens into the WebView without verifying that the application initiated the login session, exposing users to OAuth CSRF and authorization code injection.
- **Fix**:
  - Implemented `OAuthSecurityManager`:
    - Generates cryptographically secure 16-byte random `state` and 32-byte `verifier`.
    - Generates PKCE SHA-256 challenge (`BASE64URL(SHA256(verifier))`).
    - Enforces 5-minute TTL (`STATE_TTL_MS = 300,000 ms`).
    - Enforces single-use consumption (`pendingState` wiped immediately upon validation).
  - Deep-link callback (`handleDeepLink`):
    - Validates `incomingState` against `pendingState`. If invalid, missing, or expired, the callback is **rejected immediately** and an error alert is shown.
    - Forwarded authorization codes are passed to the trusted web origin using safe `Uri.Builder` (`auth_code` and `code`).
    - Deep links carrying raw tokens are discarded.

### Remediation 4: WebView Trusted Origin Restriction & External Link Routing
- **Vulnerability**: `shouldOverrideUrlLoading` permitted any HTTP or HTTPS URL to load inside the privileged WebView.
- **Fix**:
  - Restricted internal WebView navigation strictly to `TRUSTED_HOSTS = setOf("bestwayec.uz", "api.bestwayec.uz")` over HTTPS.
  - Cleartext HTTP is never trusted.
  - Any external HTTP/HTTPS URL (e.g. social media, documentation, external login providers, third-party sites) is automatically intercepted and opened in an external browser or Chrome Custom Tab via `openCustomTabOrBrowser(uri)`.
  - The privileged WebView with hardware access and JavaScript interfaces never navigates to an untrusted external origin.

### Remediation 5: Hardware Permission Origin Verification & Resource Whitelisting
- **Vulnerability**: `WebChromeClient.onPermissionRequest` did not check `request.origin`, allowing any loaded frame or site to request microphone or camera access. In addition, the permission callback granted any unknown resource in an open `else` fallback.
- **Fix**:
  - `onPermissionRequest` validates `request.origin` using `isTrustedOrigin(origin)`. If the origin is not `https://bestwayec.uz`, it calls `request.deny()` immediately.
  - Whitelisted resources strictly to:
    - `PermissionRequest.RESOURCE_AUDIO_CAPTURE` (Microphone for IELTS Speaking tests)
    - `PermissionRequest.RESOURCE_VIDEO_CAPTURE` (Camera for exam proctoring)
  - All other resource types are rejected outright.

---

## 2. Backend OAuth Integration Contract

To achieve full end-to-end native PKCE verification on Android:
1. **Authorization URL**:
   The web application or Android app opens:
   `https://bestwayec.uz/login?next=/oauth/desktop?device=android&state=<state>&code_challenge=<challenge>&code_challenge_method=S256&redirect=bestwayapp://auth/callback`
2. **Backend Redirect**:
   Upon student approval, backend redirects to:
   `bestwayapp://auth/callback?code=<code>&state=<state>`
3. **Backend Exchange**:
   The authorization code is exchanged via:
   `POST https://api.bestwayec.uz/v1/auth/desktop/exchange`
   Body: `{ "code": "<code>", "verifier": "<verifier>", "deviceId": "<deviceId>" }`
4. **Security Invariant**:
   Under no circumstances should the backend deliver raw tokens in deep-link URLs (`bestwayapp://auth/callback?token=...`).

---

## 3. Automated Test Evidence

Automated regression suite `tools/android-security.test.mjs`:
```text
✔ P0-1: AndroidBridge does not expose access or refresh tokens to JavaScript
✔ P0-2: Token duplication across localStorage, cookies and SharedPreferences is eliminated
✔ P0-3: OAuth authorization code deep-link requires strict state CSRF validation
✔ P0-4: WebView navigation is strictly locked to trusted HTTPS origins
✔ P0-5: Hardware permission requests validate origin and allow only explicit audio/video resources
✔ P0-6: Logout clears session cookies, storage and pending OAuth state without zombie re-injection
✔ P0-7: AndroidManifest and build.gradle enforce security requirements

7 tests passed (0 failed)
```

Combined release & security tool suite (`node --test`):
```text
35 tests passed (0 failed)
```

---

## 4. Real-Device Physical Testing Requirements

Before final public production release, the following tests must be performed on physical Android hardware (Android 7.0 - 14):

1. **Hardware Microphone & Camera**:
   - Run IELTS Speaking test on a real phone or tablet.
   - Verify that the system permission dialog is displayed on first use.
   - Verify that candidate audio recordings are captured with clear waveforms.
2. **Deep-Link Intent Handling**:
   - Test intent filter via adb:
     `adb shell am start -W -a android.intent.action.VIEW -d "bestwayapp://auth/callback?code=mock_code&state=mock_state"`
   - Verify rejection when no pending state exists.
3. **External Browser Hand-off**:
   - Click Google OAuth login or external link (e.g. Telegram support).
   - Verify that Chrome Custom Tab or default system browser opens, leaving the internal WebView on `bestwayec.uz`.
4. **FLAG_SECURE Exam Kiosk Mode**:
   - Navigate to `/mock/run` or `/student/exam`.
   - Attempt to take a screenshot (`Power + Volume Down`) or screen record.
   - Verify that the OS blocks the screenshot or displays a black screen.
