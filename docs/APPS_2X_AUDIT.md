# BESTWAY APPS 2.0 — COMPREHENSIVE APPLICATION AUDIT REPORT

**Audit Date:** November 17, 2026  
**Auditor:** Principal Tauri v2 / Rust Engineer & Systems Architecture Team  
**Repository:** `bestwayec/bw-tauri`  
**Branch:** `feat/bw-tauri-apps-2x`  
**Baseline Commit:** `7606078` (Merge pull request #31)  
**Target Applications:**  
1. Windows Desktop Application (Primary Priority)  
2. macOS Desktop Application  
3. Linux Desktop Application  
4. Android Mobile Application (`uz.bestwayec.app`)  

---

## 1. Executive Summary

This comprehensive audit was conducted across the desktop (Tauri v2 / Rust / React 19 / TypeScript) and Android (Kotlin / WebView) codebases. The desktop application is functional and contains robust low-level foundations (e.g., MSVC Windows keyboard hooks, native credential storage via OS keyring, AES-256 offline media encryption, and custom `bway://` streaming protocol).

However, critical architectural, security, reliability, and UI/UX vulnerabilities were identified that hinder a production-grade 2.0 release. The most severe issues include:
1. **Desktop Updater Parallel Build Race Condition**: GitHub Actions `release-desktop.yml` generates and uploads `latest.json` concurrently from 4 matrix builders (`windows-x64`, `linux-x64`, `macos-intel`, `macos-apple-silicon`), leading to upload collisions and updater metadata overwrites.
2. **Android Security & Key Generation Violations**: `release-android.yml` silently generated disposable throwaway keystores with hardcoded credentials when CI secrets were missing, violating `production-binary-guard`. Furthermore, Android's `MainActivity.kt` passed sensitive authentication tokens in plain URL query parameters on deep-link callbacks, enabled `allowFileAccess = true`, permitted cleartext HTTP traffic (`usesCleartextTraffic="true"`), and exhibited version drift (reporting `0.8.3` while the application is `1.0.11`).
3. **Fabricated / Demo Telemetry in Proctoring & Administration**: `LiveProctoring.tsx`, `GradingQueue.tsx`, `CenterOverview.tsx`, `StudentResults.tsx`, and `GroupsResults.tsx` contained hardcoded fake students, mock exams, and simulated success states in API error catch blocks.
4. **Desktop Kiosk & Offline Resilience Hardening**: Opportunities to strengthen fullscreen focus recovery, offline answer queue synchronization guarantees, and speaking recording upload persistence.

---

## 2. Detailed Technical Audit Findings

### Module A: Desktop Core & Application Lifecycle
- **Version Parity**: Desktop app is at version `1.0.11` across `package.json`, `src-tauri/tauri.conf.json`, `src-tauri/Cargo.toml`, and `src-tauri/Cargo.lock`.
- **Backend API Configuration**: Handled by `src/lib/config.ts`. Enforces HTTPS for remote targets; loopback HTTP is strictly restricted to `import.meta.env.DEV`. Release builds validate `isApiMisconfigured()`.
- **Session Management**: Rust owns the auth tokens in `src-tauri/src/session.rs`. Refresh tokens are held exclusively in the OS Keyring (`uz.bestway.exam` / `session`) or restricted local storage (0600 on Unix) and rotated atomically. The React frontend receives only access tokens via `SessionSnapshot`.
- **Boot Sequence & Splash**: Boot splash uses WebGL Three.js animation with a clean CSS fallback (`src/components/BootSplash.tsx`, `src/components/webgl-fallback.tsx`). Crash recovery modal (`CrashRecovery.tsx`) renders on window errors.

### Module B: Desktop Exam Kiosk & Anti-Cheat
- **Native Keyboard Hook (Windows)**: `src-tauri/src/lockdown.rs` implements a `WH_KEYBOARD_LL` low-level hook on a dedicated thread with its own Win32 message loop (`GetMessageW`). Swallows `VK_LWIN`, `VK_RWIN`, `Alt+Tab`, `Alt+F4`, and `Ctrl+Shift+Esc / Alt+Esc`.
- **OS Limits**: `Ctrl+Alt+Del` (Winlogon SAS) cannot be intercepted from userspace; properly documented.
- **Multi-Monitor Guard**: `set_locked` queries `window.available_monitors()`. If monitor count > 1, rejects lock with `MULTI_MONITOR_BLOCKED`.
- **Window State Enforcement**: `on_window_event` traps `Focused(false)` and `Resized(_)` during lock; automatically re-asserts fullscreen, unminimizes, and forces `set_always_on_top(true)` and `set_focus()`.
- **Clipboard Clearing**: `clear_clipboard` empties the OS clipboard on lockdown entry.
- **Offline Answer Continuity**: `src/lib/offline-exam.ts` queues answers in IndexedDB and in-memory caches. Draft restoration prioritizes pending local drafts over stale server copies before re-submitting.

### Module C: Media, Speaking & Live Proctoring
- **Audio Capture & Durability**: `src/lib/speaking-capture.ts` enforces exact duration windows and rejects empty recordings. Completed takes are persisted in IndexedDB via `src/lib/durable-recordings.ts` until backend acknowledgment.
- **Encrypted Video Protocol**: Tauri custom protocol `bway://` streams offline encrypted AES-CTR `.bway` videos with byte-range parsing clamped to 2 MiB chunks.
- **Live Proctoring / Teacher Hub (CRITICAL DEFECT)**:
  - `src/pages/LiveProctoring.tsx` contained static `INITIAL_STUDENTS` (mock candidates with fake strikes).
  - Pre-filled hardcoded room (`pin: "482910"`).
  - Action handlers (`handleStartAllExams`, `handleEndLiveRoom`, `handleSendProctorWarning`, `handleDisqualifyProctorStudent`) displayed success toasts inside `catch` blocks even when backend requests failed.
  - Room creation caught network failures and minted fake offline rooms.
  - `src/pages/GradingQueue.tsx`, `CenterOverview.tsx`, `GroupsResults.tsx`, `StudentResults.tsx` similarly relied on fake mock datasets (`INITIAL_SUBMISSIONS`, `LABS_DATA`, `RESULTS_DATA`).

### Module D: Android Application (`uz.bestwayec.app`)
- **Version Drift**:
  - `android/app/build.gradle`: `versionCode 1060`, `versionName "1.0.6"`.
  - `MainActivity.kt`: Hardcoded `USER_AGENT_SUFFIX = " BestWayApp/0.8.3 ..."` and `getVersion() = "0.8.3"`.
  - Desktop version: `1.0.11`.
- **Deep Link Token Exposure**:
  - `MainActivity.handleDeepLink` parsed `token`, `access_token`, `refresh_token` from incoming URI query parameters and redirected the WebView to `https://bestwayec.uz/?token=...`, exposing credentials in URLs and history.
- **WebView Security Flags**:
  - `allowFileAccess = true` allowed potential local file leakage from Web content.
  - `AndroidBridge` JavascriptInterface was bound globally without domain restriction.
- **Manifest Configuration**:
  - `android:usesCleartextTraffic="true"` allowed insecure HTTP downgrades.
  - `android:allowBackup="true"` allowed ADB extraction of WebView cookies/session.
- **CI Release Script (`release-android.yml`)**:
  - Generated ad-hoc dummy keystores with default password `bestway2026` if secrets were absent.

### Module E: Rust Security & Native IPC
- **Native IPC Validation**: All commands validate input paths and origins (`video_filename`, `probe_download_url`, `is_callback_arg`).
- **Memory Safety & Tests**: 34 native tests in `bestway_app_lib` pass with 0 failures on Windows x64.
- **Keyring Handling**: Hex-decoding guards prevent panics on corrupted non-ASCII data.

### Module F: Desktop Auto-Update & CI Release Workflows
- **Update Manifest Conflict**:
  - `release-desktop.yml` runs a 4-target matrix (`windows-x64`, `linux-x64`, `macos-intel`, `macos-apple-silicon`).
  - `tools/validate-release.mjs` outputs `includeUpdaterJson: true` in `signed_updater` mode for every platform.
  - All 4 builders race to write `latest.json` to the release draft simultaneously, causing asset upload failures or overwriting other platforms.
- **Manual vs Signed Updater**:
  - Minisign public key `dW50cnVzdGVk...` is verified in `tauri.conf.json`.
  - `UpdateNotifier.tsx` safely checks update eligibility before alerting students, deferring updates during active exams.

---

## 3. Findings Ledger & Remediation Plan

| ID | Module | Severity | Title | Root Cause | Target Fix |
|---|---|---|---|---|---|
| SEC-01 | Android | P0 | Disposable Keystore Fallback in CI | `release-android.yml` uses `keytool -genkeypair` if secrets missing | Abort CI build if official signing credentials are not present |
| SEC-02 | Android | P0 | Plaintext Tokens in Deep Link Redirects | `MainActivity.kt` appends tokens to `webView.loadUrl` query string | Secure token transmission; avoid URL query string leakage |
| SEC-03 | Android | P1 | Insecure Cleartext & Backup Policies | Manifest has `usesCleartextTraffic="true"`, `allowBackup="true"` | Set `usesCleartextTraffic="false"`, `allowBackup="false"` |
| SEC-04 | Android | P1 | WebView `allowFileAccess` & Global Bridge | File access enabled; bridge unrestricted | Set `allowFileAccess = false`, restrict bridge to trusted origins |
| VER-01 | Android | P2 | Android Version Drift | Version 1.0.6/0.8.3 across gradle and Kotlin | Synchronize to 1.0.11 and use `BuildConfig.VERSION_NAME` |
| REL-01 | Release | P0 | Concurrent `latest.json` Upload Race | 4 matrix jobs upload `latest.json` simultaneously | Separate platform builds from updater manifest synthesis |
| DEM-01 | Desktop UI | P1 | Fabricated Data in LiveProctoring | Hardcoded `INITIAL_STUDENTS`, fake room PIN | Remove fake students; require real live room or clean empty states |
| DEM-02 | Desktop UI | P1 | False Success Behavior in Catch Blocks | Action catch blocks toast success | Report real backend errors in catch blocks |
| DEM-03 | Desktop UI | P2 | Mock Data in Teacher/Admin Pages | `INITIAL_SUBMISSIONS`, `LABS_DATA`, etc. | Replace with real queries or clean empty/loading states |
| KSK-01 | Desktop Kiosk | P1 | Windows Focus & Exit Resilience | Multi-monitor & window event edge cases | Harden recovery, minimize-to-tray guards, and focus traps |
| UIX-01 | Desktop UI | P2 | UI/UX Polish & Empty States | High-DPI layout, contrast themes, error boundaries | Modernize styling, consistent typography and feedback |

---

## 4. Conclusion & Next Steps
With Phase 0 complete and verified, execution transitions to Phase 1 through Phase 8, addressing P0 and P1 security, updater, and kiosk defects immediately.
