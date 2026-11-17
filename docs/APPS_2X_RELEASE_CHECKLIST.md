# BESTWAY APPS 2.0 — RELEASE READINESS CHECKLIST

**Release Version:** 1.0.11 / 2.0 Upgrade Track  
**Target Release Artifacts:**  
- Windows: `bestway-app_<version>_x64-setup.exe` (NSIS Installer)  
- macOS: `bestway-app_<version>_x64.dmg` (Intel) & `bestway-app_<version>_aarch64.dmg` (Apple Silicon)  
- Linux: `bestway-app_<version>_amd64.AppImage` & `.deb`  
- Android: `bestway-app.apk` (Signed with official release keystore, v1+v2+v3, minSdk 24, universal ABI, >= 3 MB)  

---

## 1. Pre-Release Verification Gates

### Security Gates
- [ ] **No Mock / Dummy Binaries**: Repository and release assets contain only genuine compiled binaries.
- [ ] **Zero AI Attribution**: Commits authored strictly under `Komiljon Roziyev <kruziyev0@gmail.com>` with no AI bot co-authorship tags.
- [ ] **Credential Protection**: Auth tokens securely managed via OS Keyring on desktop; no token leakage via URL query parameters on Android.
- [ ] **Network Policy**: Remote API requests strictly enforce HTTPS with loopback limited to development. Cleartext HTTP disabled on Android.
- [ ] **Android Keystore Signing**: Official Release Keystore configured in CI; no throwaway keys. Signature schemes v1, v2, and v3 validated.
- [ ] **Android MinSdk**: Minimum SDK version set to 24 (Android 7.0 Nougat) or higher.
- [ ] **Android APK Size**: Production APK verified >= 3 MB (3,145,728 bytes).

### Desktop Core & Kiosk Gates
- [ ] **Clean Boot & Session Restore**: App loads immediately from cached profile without network hang-up.
- [ ] **Windows Kiosk Lock**: `WH_KEYBOARD_LL` hook swallows system shortcuts (Win, Alt+Tab, Alt+F4, Ctrl+Shift+Esc).
- [ ] **Multi-Monitor Restriction**: Lockdown blocks multiple active displays.
- [ ] **Window Focus Enforcement**: Window automatically recovers fullscreen, always-on-top, and focus on blur or resize.
- [ ] **Offline Continuity**: Answers stored locally during network disruption and flushed with atomic verification on reconnect.
- [ ] **Durable Audio Recordings**: Speaking recordings preserved in IndexedDB until server receipt is confirmed.
- [ ] **Zero Fabricated Proctoring Data**: No hardcoded demo students or fake success toasts in LiveProctoring or grading screens.

### Updater & Packaging Gates
- [ ] **Synchronized Versions**: `package.json`, `tauri.conf.json`, `Cargo.toml`, and Android `build.gradle` align.
- [ ] **Updater Manifest Race Prevention**: Multi-platform CI builds do not overwrite or collide on `latest.json`.
- [ ] **Signed Updater Verification**: Minisign signature matches `plugins.updater.pubkey`.
- [ ] **Manual Installer Fallback**: Valid fallback link available if auto-updater cannot reach release manifest.

---

## 2. Platform Matrix Sign-Off

| Platform | Build Architecture | Installer Type | Verified Environment | Status |
|---|---|---|---|---|
| **Windows** | x86_64-pc-windows-msvc | NSIS `.exe` | Windows 10/11 Host | Passed Unit & Cargo Tests |
| **macOS Intel** | x86_64-apple-darwin | `.dmg` / `.app` | macOS CI Runner | Pending Workflow Run |
| **macOS Silicon**| aarch64-apple-darwin | `.dmg` / `.app` | macOS CI Runner | Pending Workflow Run |
| **Linux** | x86_64-unknown-linux-gnu| `.AppImage` / `.deb`| Ubuntu CI Runner | Pending Workflow Run |
| **Android** | Universal (ARM + ARM64) | Signed `.apk` | Android SDK 34 / Gradle | Build Config Audited |

---

## 3. Final Sign-Off Criteria
All automated regression tests (Vitest, Rust, Playwright, Node release checks) must pass at 100% with 0 failures before any release candidate is published.
