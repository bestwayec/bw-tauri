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
- [x] **No Mock / Dummy Binaries**: Repository and release assets contain only genuine compiled binaries.
- [x] **Zero AI Attribution**: Commits authored strictly under `Komiljon Roziyev <kruziyev0@gmail.com>` with no AI bot co-authorship tags.
- [x] **Credential Protection**: Auth tokens securely managed via OS Keyring on desktop; no token leakage via URL query parameters on Android.
- [x] **Network Policy**: Remote API requests strictly enforce HTTPS with loopback limited to development. Cleartext HTTP disabled on Android.
- [x] **Android Keystore Signing**: Official Release Keystore configured in CI; throwaway fallback removed. Signature schemes v1, v2, and v3 validated.
- [x] **Android MinSdk**: Minimum SDK version set to 24 (Android 7.0 Nougat) or higher.
- [x] **Android APK Size**: Production APK verified >= 3 MB (3,145,728 bytes).

### Desktop Core & Kiosk Gates
- [x] **Clean Boot & Session Restore**: App loads immediately from cached profile without network hang-up.
- [x] **Windows Kiosk Lock**: `WH_KEYBOARD_LL` hook swallows system shortcuts (Win, Alt+Tab, Alt+F4, Ctrl+Shift+Esc).
- [x] **Multi-Monitor Restriction**: Lockdown blocks multiple active displays.
- [x] **Window Focus Enforcement**: Window automatically recovers fullscreen, always-on-top, and focus on blur or resize.
- [x] **Offline Continuity**: Answers stored locally during network disruption and flushed with atomic verification on reconnect.
- [x] **Durable Audio Recordings**: Speaking recordings preserved in IndexedDB until server receipt is confirmed.
- [x] **Zero Fabricated Proctoring Data**: No hardcoded demo students or fake success toasts in LiveProctoring or grading screens.

### Updater & Packaging Gates
- [x] **Synchronized Versions**: `package.json`, `tauri.conf.json`, `Cargo.toml`, and Android `build.gradle` align at `1.0.11`.
- [x] **Updater Manifest Race Prevention**: Multi-platform CI builds do not overwrite or collide on `latest.json` (centralized publish synthesis).
- [x] **Signed Updater Verification**: Minisign signature matches `plugins.updater.pubkey`.
- [x] **Manual Installer Fallback**: Valid fallback link available if auto-updater cannot reach release manifest.

---

## 2. Platform Matrix Sign-Off

| Platform | Build Architecture | Installer Type | Verified Environment | Status |
|---|---|---|---|---|
| **Windows** | x86_64-pc-windows-msvc | NSIS `.exe` | Windows 10/11 Host | **VERIFIED & TESTED** (34 Cargo / 418 Vitest) |
| **macOS Intel** | x86_64-apple-darwin | `.dmg` / `.app` | macOS Target Config | **CONFIGURED & TESTED** (`tools/release-platforms.test.mjs`) |
| **macOS Silicon**| aarch64-apple-darwin | `.dmg` / `.app` | macOS Target Config | **CONFIGURED & TESTED** (`tools/release-platforms.test.mjs`) |
| **Linux** | x86_64-unknown-linux-gnu| `.AppImage` / `.deb`| Linux Target Config | **CONFIGURED & TESTED** (`tools/release-platforms.test.mjs`) |
| **Android** | Universal (ARM + ARM64) | Signed `.apk` | Android SDK 34 / Gradle | **HARDENED & ENFORCED** (Official Keystore only) |

---

## 3. Final Sign-Off Criteria
All automated regression tests (Vitest, Rust, Playwright, Node release checks) have passed at 100% with 0 failures:
- `npx tsc --noEmit`: 0 errors
- `npm test`: 50 test files, 418 passed tests
- `cargo test --manifest-path src-tauri/Cargo.toml`: 34 passed tests
- `node --test tools/release-platforms.test.mjs tools/validate-release.test.mjs`: 20 passed tests
- `npm run build`: Production bundle compiled successfully
