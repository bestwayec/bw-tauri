# BESTWAY ALL DEVICES 2.0 — PHASE 0 REPOSITORY AUDIT

- **Repository:** `bestwayec/bw-tauri`
- **Audit Baseline SHA:** `88b9bde16f07905271f21b98510acbc9c76a4933` (`main` after PR #40 + PR #41)
- **Working Branch:** `feat/bestway-all-devices-2-0`
- **Latest Public Release:** `v1.0.12` (`900c563`)
- **Backend Reference (Read-Only):** `../bestway/backend-django`

---

## 1. Synchronized Baseline & PR Recovery

1. **Workspace Sync:**
   - Original local `main`: `8acf3a8a9f899c2cf536f7aaaacb75299d08c6d2`
   - Remote `origin/main` before PR merges: `b9fb6bbeeebad5d67183ba8605d24417405682c5`
   - Fast-forwarded local `main` cleanly with zero discarded work.
2. **PR #40 (`fix/desktop-phase0-offline-ack-race`):**
   - Verified `resolvePendingAnswers` awaits queued `answerWrites` for acknowledged keys before compare-and-delete.
   - Executed `offline-exam.test.ts` (13/13 pass) and `tsc --noEmit` locally; verified 5/5 CI checks green. Merged into `main` at `032ebc4d0bf2b9f9384f03b2368b81fdb2a93082`.
3. **PR #41 (`fix/windows-exam-answer-receipts`):**
   - Verified `saveMockAnswer`, `bulkMockAnswers`, and `saveAnswer` against Django backend contracts (`mock_attempts.py`, `legacy_tests.py`) and `tools/mock-server/server.mjs`.
   - Executed `legacy-submission.test.ts` (12/12 pass), `mocks.test.ts` (27/27 pass), and `tsc --noEmit` locally; verified 5/5 CI checks green. Merged into `main` at `88b9bde16f07905271f21b98510acbc9c76a4933`.

---

## 2. Baseline Verification Snapshot (Pre-2.0 Changes)

| Check | Result | Notes |
| --- | --- | --- |
| `npm test` (Vitest) | **65 files / 520 tests PASS** | Verified on `88b9bde` after `npm ci` |
| `npx tsc --noEmit` | **PASS (0 errors)** | Verified on `b9fb6bb` and PR #40/#41 heads |
| `npm run build` | **PASS** | Verified on `b9fb6bb` |
| `node --test tools/*.test.mjs` | **50/50 PASS** | Android OAuth/security/signing, release planning, updater manifest, Windows validation |
| `npm run test:e2e` (Chromium 1248) | **6/7 PASS (1 timeout)** | `offline-vocabulary.spec.ts` timed out at 45s using full Chrome on cold Vite compile; re-testing with `chrome-headless-shell.exe` |
| `cargo check` / `cargo clippy -- -D warnings` / `cargo test` | **IN PROGRESS** | Initial `C:` run failed with `os error 112` (0.25 GB free on `C:`); cleaned 11.8 GiB `src-tauri/target` and running on `D:\bw-tauri-target` |

---

## 3. Architectural Overview

- **Desktop Core (`src-tauri/`):** Tauri v2 (`2.0` series), Rust backend owning auth refresh + OS credential store (`keyring`: Windows Credential Manager / macOS Keychain / Linux Secret Service with fresh-handle read-back verification and no plaintext file token fallback), Win32 `WH_KEYBOARD_LL` keyboard hook + fullscreen/always-on-top/content-protection kiosk (`lockdown.rs`), single-instance + deep-link OAuth forwarding, AES-256-GCM encrypted offline media (`bway://`), and HTTPS-allowlisted `probe_download_url`.
- **Frontend (`src/`):** React 19 + TypeScript + Vite 8 + Tailwind v4 + TanStack Query + Zustand. Unified `ExamRunner.tsx` serves IELTS Academic/General, Multilevel (CDI/DTM), Listening, Reading, Writing, Speaking, Classroom, Live PIN, and legacy/practice tests. Offline cache uses IndexedDB (`bestway-offline-v1` & `bestway-recordings-v1`) with `localStorage` queue fallback.
- **Android (`android/`):** Native Kotlin `WebView` wrapper (`uz.bestwayec.app`, `minSdk 24`, `targetSdk 34`) targeting `https://bestwayec.uz/?platform=mobile_app` with Custom Tabs PKCE-S256 OAuth, HttpOnly WebView cookies, `FLAG_SECURE` during exam routes, and origin-gated `AndroidBridge`.

---

## 4. Classified Findings Register

### P0 — Critical (Data Loss, Security, Incorrect Results, Impossible Exam/Install)

| ID | Area | Finding & Root Cause | Affected Files |
| --- | --- | --- | --- |
| `P0-DATA-01` | Writing / Offline | `EssayWidget` restores `examui.essay.<attemptId>.<qid>` whenever `value` is falsy on any render, resurrecting intentionally cleared essays; `examui.essay.*` is never cleaned up on submission. | `src/components/exam-ui/widgets.tsx`, `src/lib/offline-exam.ts` |
| `P0-DATA-02` | Exam Durability | `offlinePut` returns `false` on quota/disk-full errors and `ExamRunner` ignores it (`void cacheAnswer(...).catch(...)`); `offlineGet`/`offlineList` return `null`/`[]` on DB read failure, masking read errors as empty; no explicit durability states (`server_acknowledged`, `locally_persisted`, `pending_sync`, `memory_only`, `persistence_failed`, `conflict_detected`); `mocks.ts` does not send `editedAt` or handle `result.stale` from Django `save_answers`. | `src/lib/offline-store.ts`, `src/lib/offline-exam.ts`, `src/lib/mocks.ts`, `src/components/exam-ui/ExamRunner.tsx`, `src/components/exam-ui/TopBar.tsx` |
| `P0-DATA-03` | Speaking / Recovery | `MockExam.tsx:150` skips `recoverRecording()` when `start.exam.specificationVersion` is truthy (Multilevel), while line 269 blocks submit if `hasPendingRecordings()` is true; `speaking-capture.ts:17` rejects valid takes if event-loop timer jitter exceeds `+250ms`. | `src/pages/MockExam.tsx`, `src/lib/speaking-capture.ts` |
| `P0-DATA-04` | Legacy Tests | `TestRunner.tsx` uses client clock (`new Date().toISOString()`) instead of server clock offset, and its sequential `saveMany` does not record partial progress when a later question fails. | `src/pages/TestRunner.tsx` |
| `P0-UPD-01` | Updater | `UpdateNotifier.tsx` only hides UI button with `deferInstall`; lacks app-level guard blocking relaunch/download-to-install race when an exam starts or pending exam recovery exists. `src/lib/version.ts` has stale `DESKTOP_INSTALLER_VERSION = "1.0.11"` and `shouldNotifyUpdate` rejects `-rc.N` semver tags. | `src/lib/version.ts`, `src/components/UpdateNotifier.tsx`, `src/App.tsx` |
| `P0-WIN-01` | Windows Installer | `tauri.conf.json` lacks explicit `bundle.windows.nsis` settings (`installMode`, WebView2 install mode, upgrade/shortcut metadata) and optional Authenticode signing wiring; current version is `1.0.12`. | `src-tauri/tauri.conf.json` |
| `P0-SEC-01` | Session / Logout | `App.tsx:handleLogout` does not check or warn about unsynchronized offline exam answers or pending speaking recordings before clearing session state; `ExamRunner` `examui.queue.*` is not account-scoped. | `src/App.tsx`, `src/components/exam-ui/ExamRunner.tsx` |

### P1 — Major Reliability, Compatibility, Recovery, or UX/Integrity

| ID | Area | Finding & Root Cause | Affected Files |
| --- | --- | --- | --- |
| `P1-EXAM-01` | Full-Test Flow | In `MockExam.tsx:272-275`, advancing a `full_test` section runs inside `ExamRunner.doSubmit()`, which invokes `releaseKioskLockdown()` and `clearAttemptCache()` mid-exam and does not update `persistActiveMockSession` with the next section. | `src/pages/MockExam.tsx`, `src/components/exam-ui/ExamRunner.tsx`, `src/App.tsx` |
| `P1-LISTEN-01` | Listening | `ListeningEngine.handleAudioError` displays `"Retrying..."` for code 2 without performing retry or offering a strict-mode recovery button; strict-mode playback state resets on restart; `MultilevelListening` does not sync with `VOLUME_EVENT` or support retry on stalled load/play. | `src/components/exam-ui/ListeningEngine.tsx`, `src/components/exam/multilevel-media.tsx` |
| `P1-SPEAK-01` | Speaking | `SpeakingPane` lacks microphone device selection, `MediaStreamTrack.onended` disconnect handling, and supported MIME probing (`isTypeSupported`) before `new MediaRecorder(stream)` (risk on WebKit/macOS/some WebViews). | `src/components/exam/SpeakingPane.tsx`, `src/lib/audio-capture.ts` |
| `P1-READY-01` | Readiness Center | `DeviceReadinessModal` omits app version display check, backend health/auth compatibility, IndexedDB R/W persistence check, viewport/resolution check, active attempt/pending sync check, and redacted technician diagnostic export. | `src/components/DeviceReadinessModal.tsx` |
| `P1-KIOSK-01` | Exam Center Kiosk | Timer during OS sleep/suspend relies on `setInterval` without immediate visibility/focus resync; `ExamRunner` lacks explicit supervisor-assisted recovery/emergency exit messaging; `useAntiCheatGuard` can be noisy on transient system dialogs. | `src/hooks/useLockdown.ts`, `src/hooks/useAntiCheatGuard.ts`, `src/components/exam-ui/ExamRunner.tsx` |
| `P1-UI-01` | Admin / Results | `CenterOverview.tsx` renders hardcoded numbers (`"Across 3 active labs"`, `"114"`, `"98.2%"`, `"3"`, `"100%"`, `"4 total computer labs"`) regardless of `/v1/admin/labs` data. | `src/pages/CenterOverview.tsx` |
| `P1-AND-01` | Android | `MainActivity.kt` requests `Manifest.permission.CAMERA` unconditionally in `onCreate` even when camera is not needed; hardcodes `APP_VERSION = "1.0.12"` instead of `BuildConfig.VERSION_NAME`; `setDownloadListener` does not verify `https://` origin. | `android/app/src/main/java/uz/bestwayec/app/MainActivity.kt` |
| `P1-READ-01` | Reading | Reading navigation lacks keyboard next/prev question shortcuts; `PassagePane` `examui.marks.*` is never cleaned up on completion; responsive behavior across 1024x768–1920x1080 and 125–200% DPI needs test coverage. | `src/components/exam-ui/PassagePane.tsx`, `src/components/exam-ui/ExamRunner.tsx` |

### P2 / P3 — Performance, Maintainability & Polish

| ID | Area | Finding & Root Cause | Affected Files |
| --- | --- | --- | --- |
| `P2-PERF-01` | Bundle / Memory | `vite.config.ts` imports `./src/lib/api-origin` without `.ts` triggering Vite 8 native config loader warning; `GappedContent` re-parses HTML via `DOMParser` on every keystroke in `ExamRunner` (can debounce/optimize or isolate answer state from `PassagePane`/`TopBar` rerenders). | `vite.config.ts`, `src/components/exam-ui/ExamRunner.tsx`, `src/components/exam/GappedContent.tsx` |
| `P2-TEST-01` | E2E / CI | `e2e/offline-vocabulary.spec.ts` timed out at 45s on cold Vite compile with full Chrome; CI lacks multi-viewport Reading layout check and packaged updater guard verification. | `playwright.config.ts`, `e2e/`, `.github/workflows/` |
| `P3-UX-01` | Localization / UI | Mixed Uzbek/English strings across `MockExam`, `DeviceReadinessModal`, `Settings`, `Profile`; `Profile` and `Settings` duplicate the `Confirm before submitting` toggle. | `src/pages/Settings.tsx`, `src/pages/Profile.tsx`, `src/components/DeviceReadinessModal.tsx` |
