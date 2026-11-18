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

### Remediation 3: OAuth Authorization Code + PKCE-S256 Flow with Strict State Validation & Verifier Exchange
- **Vulnerabilities Remediated**:
  1. `createPendingLogin` and `generateCodeChallenge` were defined but not called in the real login initiation path.
  2. Outgoing navigation URLs were previously trusted for `state` rather than enforcing a cryptographically random, locally initiated attempt.
  3. Deep-link callbacks previously forwarded authorization codes to a website URL query parameter without executing a matching PKCE code verifier exchange.
  4. Pending OAuth state kept exclusively in volatile heap memory broke login flows when Android OS recreated the activity process during external browser navigation.
- **Hardened Architecture & Implementation**:
  - `OAuthSecurityManager`:
    - Generates 16-byte cryptographically secure random `state` (32 hex characters) and 32-byte `verifier` (64 hex characters) via `SecureRandom`.
    - Computes PKCE code challenge using SHA-256 with standard RFC 7636 Base64URL encoding (`generateCodeChallenge(verifier)`).
    - Persists pending session (`state`, `verifier`, `deviceId`, `createdAt`) into private Android `SharedPreferences` (`uz.bestwayec.app.oauth_state`) so state is preserved across background activity termination and process recreation.
    - Enforces 5-minute TTL (`STATE_TTL_MS = 300,000 ms`).
    - Enforces single-use consumption: wipes state and verifier from storage immediately upon validation, completely defeating replay attacks.
  - **Login Initiation (`initiateOAuthLogin`)**:
    - Triggered via `AndroidBridge.startOAuthLogin(provider)` or interception of OAuth identity providers (`accounts.google.com`, `oauth2.googleapis.com`, `/oauth/desktop`, `/auth/google`) in `handleUrl`.
    - Constructs the authorized initiation URL:
      `https://bestwayec.uz/login?next=/oauth/desktop?device=android&state=<state>&code_challenge=<challenge>&code_challenge_method=S256&redirect=bestwayapp://auth/callback`
    - Launches Chrome Custom Tab or default system browser, preserving the privileged WebView origin boundary.
  - **Deep-Link Callback & Exchange (`handleDeepLink` -> `performCodeExchange`)**:
    - Catches `bestwayapp://auth/callback?code=...&state=...` (also supports `bestway-exam://` and `bestway://`).
    - Validates incoming `state` against locally persisted attempt via `OAuthSecurityManager.validateAndConsumeState(this, state)`.
    - If valid, retrieves the matching `verifier` and `deviceId`.
    - Performs background HTTP POST to `POST https://api.bestwayec.uz/v1/auth/desktop/exchange` with payload `{"code": code, "verifier": verifier, "deviceId": deviceId}`.
    - On HTTP 200: parses `accessToken`, establishes session cookies in `CookieManager` (`token`, `access_token`, `bw_mobile_app`), and navigates WebView to `https://bestwayec.uz/?platform=mobile_app`.
    - On error: displays meaningful backend error feedback without false-success claims.

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

Automated behavioral test suite `tools/android-oauth.test.mjs` (8 tests):
```text
✔ Behavioral 1: Full end-to-end OAuth PKCE login flow
✔ Behavioral 2: Invalid State CSRF rejection (fail-closed, 0 network requests)
✔ Behavioral 3: Expired State rejection (> 5 minutes TTL)
✔ Behavioral 4: Replay attack prevention (single-use state consumption)
✔ Behavioral 5: Missing or corrupted verifier fails closed
✔ Behavioral 6: Process recreation survival (persisted state & verifier)
✔ Behavioral 7: Secure Logout purges cookies, web storage, and pending state
✔ Behavioral 8: Account switching without zombie token leaks

8 tests passed (0 failed)
```

Automated regression suite `tools/android-security.test.mjs` (7 tests):
```text
✔ P0-1: AndroidBridge does not expose access or refresh tokens to JavaScript
✔ P0-2: Token duplication across localStorage, cookies and SharedPreferences is eliminated
✔ P0-3: OAuth authorization code deep-link requires strict state CSRF validation and PKCE exchange
✔ P0-4: WebView navigation is strictly locked to trusted HTTPS origins
✔ P0-5: Hardware permission requests validate origin and allow only explicit audio/video resources
✔ P0-6: Logout clears session cookies, storage and pending OAuth state without zombie re-injection
✔ P0-7: AndroidManifest and build.gradle enforce security requirements

7 tests passed (0 failed)
```

Combined release & security tool suite (`node --test`):
```text
43 tests passed (0 failed)
```

Kotlin Unit Tests (`android/app/src/test/java/uz/bestwayec/app/OAuthSecurityManagerTest.kt`):
- `testCreatePendingLoginGeneratesCryptographicTokens`: PASS
- `testGenerateCodeChallengeRFC7636Format`: PASS
- `testBuildAuthorizeUrlContainsRequiredParams`: PASS
- `testValidateAndConsumeStateSuccess`: PASS
- `testValidateAndConsumeStateSingleUseReplayPrevention`: PASS
- `testValidateAndConsumeStateRejectsInvalidState`: PASS
- `testValidateAndConsumeStateRejectsExpiredState`: PASS
- `testClearPurgesPendingSession`: PASS

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
