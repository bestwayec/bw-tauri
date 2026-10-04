# Multilevel desktop 0.5.0

Branch: `feat/multilevel-exam-track`; baseline main `eb3a7a2d6342a14b1c201f04124901186ab20e49`.

This client uses the companion bestway backend's versioned `/mock` engine and `/exam-programs/mine` endpoints. Enrollment/default track are server state. Dashboard, profile, catalog and history support Multilevel. The runner reuses existing objective widgets, accepts task guidance and server deadlines, advances full-test sections, renders estimated /75 results, and preserves completed Speaking takes in IndexedDB until upload acknowledgement. Autosave requests are serialized and acknowledged values are compared before clearing dirty data. IELTS contracts remain compatible.

Specification/scoring business rules live in the backend. The client does not convert raw marks, calculate CEFR levels or award AI scores. Timed Listening requests preparation/play grants; media Range requests are authenticated. Speaking uses server-issued phases, microphone preflight, automatic recording stop, bounded upload recovery and visible uploaded progress.

The release version is consistently 0.5.0 in package.json, package-lock.json, Cargo.toml, Cargo.lock and tauri.conf.json. Existing dependency versions are preserved; missing optional lock entries were repaired.

Verification: clean npm install and dry-run passed; `npm test` passed 71 tests/6 files (baseline 57/5); `npm run build` passed on TypeScript 5.6.3/Vite 8.2.2/React 19.2.8, with the existing bundle warning. Tauri JS is 2.11.1 and Rust Tauri is locked at 2.11.5. The native Rust edition is 2021, minimum toolchain 1.77.2. Cargo is unavailable on this host, so a packaged native build and real microphone/kiosk test remain unverified. Rust session/keyring/kiosk behavior was not edited.

The companion backend passed 124 unit tests, an additive migration against existing PostgreSQL 17.11 fixture data, and 35 authenticated HTTP checks including preview/two-play rules, audio range streaming, section isolation, enrollment revocation and duplicate submission. See `bestway/docs/MULTILEVEL_EXAM_TRACK.md` in the sibling checkout for architecture, migration, scoring and reproduction details.

No AI assessment provider/STT service or calibrated Rasch parameters exist in the backend. Writing/Speaking use real teacher review. The pre-existing supervised `/exam-sessions` client contract still has no backend implementation; this integration uses `/mock` instead. No production deployment, push, OAuth or credential storage change was performed.

## Independent hardening verification — 2026-10-04

The follow-up fix commit retains the original 0.5.0 implementation. Manual Multilevel submission now waits for successful answer acknowledgement; stale queues cannot overwrite a locked section, and Multilevel local answer persistence is synchronous. Expired transitions retry after recoverable failures. Microphone state blocks submission through finalization/upload, handles denied/missing/unsupported capture, closes resources on failure/unmount, and retains a completed take in memory when IndexedDB fails. MP4 recordings use an M4A upload filename.

Fresh results: `npm test` passed **78 tests/8 files**, `npx tsc --noEmit` passed, and `npm run build` passed with the existing large-chunk warning. There is no desktop lint script/configuration. Companion backend/web checks passed 129/60 tests, all production JavaScript builds, 121 authenticated HTTP checks, 76 independent scoring-table comparisons and fresh migration/drift checks. Recording storage tests model IndexedDB contracts; they do not validate native capture or real storage quotas.

Verdict: **BLOCKED_FOR_PR**. Cargo, rustc and rustup are absent; `cargo fmt --check`, `cargo check`, `cargo test` cannot execute. `npm run tauri -- build --no-bundle` fails at Cargo metadata. `npm run tauri -- info` reports missing MSVC/SDK despite installed WebView2. **NATIVE_MICROPHONE_UNVERIFIED**: build the native app on a provisioned Windows toolchain, then test sign-in, enrollment, permission grant/denial, device removal, timed recording, playback where supported, upload/retry, submit and review/reopen. No push, PR or deployment occurred. Full evidence is in the parent workspace `FINAL_HARDENING_REPORT.md`.
