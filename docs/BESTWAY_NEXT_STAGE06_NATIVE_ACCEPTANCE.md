# BESTWAY NEXT — Stage 06 native acceptance (desktop + Android)

Branch `feat/bestway-next-stage05-completion`, [PR #39](https://github.com/bestwayec/bw-tauri/pull/39).
Session 2026-11-21. The reusable step-by-step checklist stays in
[`BESTWAY_NEXT_NATIVE_ACCEPTANCE.md`](BESTWAY_NEXT_NATIVE_ACCEPTANCE.md); this file records what was
actually executed for Stage 06 and what remains.

## Executed

| Case | Where | Result |
| --- | --- | --- |
| TypeScript | `npx tsc --noEmit` (local) | PASS |
| Vitest | `npx vitest run` (local) | PASS — 63 files, 493 tests (baseline 62 / 485) |
| Release/Windows tool tests | `node --test tools/*.test.mjs` (local) | PASS — 50 |
| Vite production build | `npm run build` (local) | PASS |
| Rust unit tests | `cargo test --lib` (Linux local) | PASS — 33 (the Windows-only keyring test is `cfg(windows)`) |
| Strict Clippy | `cargo clippy --all-targets -- -D warnings` (local) | PASS |
| Windows: tests incl. native keyring test, NSIS build, clean install + launch, WebView2 startup evidence | hosted `Windows installer validation` on `8cf17a8` ([run](https://github.com/bestwayec/bw-tauri/actions/runs/44872565399)) | PASS |
| Linux: cargo check/clippy/tests | hosted `CI` → `rust` on `8cf17a8` | PASS |
| Android: unit tests, release assemble, install + launch offline on emulator | hosted `CI` → `android` on `8cf17a8` ([run](https://github.com/bestwayec/bw-tauri/actions/runs/44872565485)) | PASS |
| Browser exam recovery | hosted `Browser exam recovery validation` on `8cf17a8` | PASS |
| Real-backend cross-client journey | browser build of this app (Vite, `VITE_API_URL` → local Django + PostgreSQL), synthetic accounts | PASS — student sees an assignment created on the website, the deep link opens that exact collection (3 cards), student gets 403 on the teacher report |

Screenshots: `docs/screenshots/stage06/desktop-student-dashboard-real-django.webp`,
`docs/screenshots/stage06/desktop-student-vocabulary-deeplink.webp`.

## Windows keyring failure (A2) — root cause record

- Symptom: `native_session_survives_new_credential_entry_and_load` → `NoEntry` at `session.rs:598`,
  33/34 passed, on `146e1d0`; the same test passed on `cf645e4` with an unchanged `session.rs`.
- Classification: (3) faulty test setup / (4) lifecycle-concurrency. Parallel tests wrote the real
  Credential Manager concurrently and fixture identity relied on clock resolution.
- Product hardening: a native write is trusted only after a fresh-handle read-back; otherwise the
  session is kept in the 0600 file fallback (no silent loss of the rotated refresh token).
- Native requirement retained: the test still runs against the real Windows Credential Manager. It was
  not mocked, skipped or `#[ignore]`d.

## Offline data privacy model (verified by code review + existing tests)

- Vocabulary snapshots and pending flashcard operations live in IndexedDB under an account-scoped
  namespace (`vocab.<userId>.<assignmentId>`); they are **not encrypted at rest**.
- Explicit sign-out asks for confirmation, then `purgeAccountOfflineVocabulary(userId)` removes that
  account's snapshots and unsynced operations; failure is reported to the user.
- Requests are bound to the signed-in account (`assertStudyAccount`) so a switched session cannot
  sync another account's queue.
- Refresh tokens are owned by Rust (OS credential store or 0600 file); the WebView snapshot never
  contains the refresh token (`webview_snapshot_does_not_expose_refresh_tokens`).
- Shared classroom PCs: use separate Windows profiles per learner; do not rely on IndexedDB for
  privacy within one OS profile.

## Not executed — UNVERIFIED

| Case | Why | Owner action |
| --- | --- | --- |
| Physical Windows 10, ~4 GB RAM: install, login, session restore, teacher workspace, vocab download/offline/sync, exam interruption + recovery, audio, signed update, shutdown, memory | no hardware | run `BESTWAY_NEXT_NATIVE_ACCEPTANCE.md` sections "Run the same scenarios" + "Physical Windows and Android evidence" |
| Android authenticated journey (OAuth callback, cookie contract, account switch, back navigation, audio) | emulator job is offline by design; no approved test backend here | run on device against the approved acceptance backend |
| Android signing certificate continuity | requires owner-held keystore | compare SHA-256 signer of the release APK with the published app |
| Linux packaged DEB/AppImage login + restore | not re-run this session (prior PASS recorded in the checklist file) | re-run before release with the final HEAD |
| macOS DMG install, signing, notarization | no macOS host | do not claim |
