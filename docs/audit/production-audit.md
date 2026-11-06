# BESTWAY desktop production audit

Audit date: 2026-11-06. Assessment: **hardening implemented and locally verified; not approved for production release**. Windows installation/upgrade, signed updater installation, production connectivity and physical-device checks remain outstanding.

## Scope and delivery

- Desktop repository: `bestwayec/bw-tauri`, starting commit `4579ea253b5b82922f7048cb03f90e9665538632`.
- Backend repository: `bestwayec/bestway`, inspected commit `fbc62396757c6566ff2eb988c9e41b0022ed9141`. Django implementation is in `backend-django/`; `backend/` contains the Prisma schema. Backend files were not modified.
- Reviewed **133 files**: 103 desktop files and 30 backend files. The accompanying `reviewed-files.txt` enumerates files reviewed in full or through relevant implementation/contract sections. This is a bounded audit, not a claim that every file or platform was audited exhaustively.
- Branch: `audit/bw-tauri-production-hardening`. `main` was not changed.
- Implementation commits: `cda5cf729cb06e57e6937f56ae1296c3d0dcf6fb` (security/native boundaries/dependencies) and `e0e3c4908c56c5048524d75c8cdd4109975a7512` (exam recovery/browser and Windows verification).
- Branch push succeeded. **PR creation BLOCKED**: `gh pr create` returned `Post "https://api.github.com/graphql": Forbidden`. No PR URL exists from this run. Creation page: https://github.com/bestwayec/bw-tauri/pull/new/audit/bw-tauri-production-hardening . The prepared PR body is retained in `pull-request.md`.
- Reading existing PRs/issues/default-branch metadata and recent Actions runs through the GitHub API was also blocked. Git HTTPS reads and branch push worked; a missing GitHub token was not inferred.
- No production records, databases, release tags, releases or signing credentials were changed.

## Reproducible baseline

Before source changes, frozen npm dependency installation, `npx tsc --noEmit`, all 344 Vitest tests and `npm run build` passed. The release planning check failed because `Entitlements.plist` declared two keys while the existing regression expected the supported audio-input key alone. npm audit found three high-severity dependency entries: `source-map-js`, `vite`, and `zod`.

The host had no Rust initially; onboarding installed stable Rust 1.99.1. Host `cargo check`, clippy and tests stopped at absent GLib/GTK/WebKit development packages. Host package installation was unavailable to the non-root user. A disposable Debian container with the repository's Linux prerequisites subsequently enabled full native validation. No host verification was claimed from an isolated source harness alone.

The initial RustSec lockfile scan found 11 vulnerability entries in TLS roots/verification, rustls, and the Windows ZIP dependency. It also reported informational unsoundness/maintenance warnings. These were assessed separately from application exploitability.

## Confirmed findings

`FIXED` means the relevant implementation was changed and the cited local regression/build checks passed; it does not imply Windows GUI, hardware or deployed-production verification.

| ID | Severity | Status | Evidence/root cause | Implemented change and verification |
| --- | --- | --- | --- | --- |
| A01 | P0 | FIXED | `api.ts` login/setSession and `oauth.ts` exchange wrote plaintext access/refresh tokens despite native ownership; the synchronous getter could revive a stale raw token. | Removed duplicate writes/fallback reads, retained successful legacy migration, cleaned legacy copies after native adoption. API/session regressions and real Chromium encrypted-storage/reload test pass. |
| A02 | P0 | FIXED | `Login.handleCallback` accepted token callbacks before checking state, and passed the access token as a query parameter to `/auth/me`. | All callback types require matching unexpired state; callback origins/userinfo are validated; `/auth/me` receives authorization headers; identity is checked before replacing the session. OAuth/API regressions pass. Legacy token callbacks must echo the pending state; unsolicited token links are intentionally rejected. |
| A03 | P0 | FIXED | Native video protocol accepted arbitrary filesystem paths, and download filename input could escape `offline_videos`. Exposure was established at the native handler/command boundary; remote exploitability through every WebView configuration was not asserted. | Canonical root confinement rejects traversal and symlink escapes; download names are restricted to simple names. Native filesystem and encrypted protocol tests pass. |
| A04 | P1 | FIXED | Two API refresh paths could rotate a refresh family concurrently; both cleared the session after transient errors. | One session owner/flight; late 401s reuse a newer access token; only definitive revocation verdicts wipe the session. Ten-way refresh, timeout/5xx/contention, multipart retry and revoked-session tests pass. |
| A05 | P1 | FIXED | JS and Rust logout posted refresh tokens without authorization to the authenticated `/auth/logout` route. | Use the existing `/auth/logout-refresh` family-revocation route. Django `apps/core/urls.py`, `views.logout_refresh_view` and `auth_service.revoke_refresh_family` establish this contract. Browser logout regression and native logout tests pass. |
| A06 | P1 | FIXED | Late refresh completion could resurrect a wiped/replaced session; metadata persistence could write an older token snapshot back over a rotated pair. | JS/native generation checks, serialized native persistence, metadata-only IPC update, and native-only refresh-token snapshots. Rust/JS regressions cover clear/replacement races and refresh preservation. |
| A07 | P1 | FIXED | A session was published as ready before async token persistence completed; native persistence errors were swallowed and migration could delete the only usable copy. | Publish readiness after persistence acknowledgment; propagate native storage errors; remove legacy data only after native acceptance. Regression covers delayed storage acknowledgment and failed migration. Chromium verifies immediate reload. |
| A08 | P1 | FIXED | An old autosave acknowledgment deleted a newer mirrored answer by question ID; direct/reconnect save paths bypassed the serialized queue. | Acknowledgments match response snapshots and use atomic IndexedDB compare/delete. Keystroke writes are ordered; immediate/reconnect saves use the same queue. Real IndexedDB and offline queue regressions pass. |
| A09 | P1 | FIXED | Offline restore preferred an older server answer, and a prematurely set recovery flag prevented StrictMode retries. IELTS queue writes were also delayed across immediate reload. | Pending local drafts take priority without replacing edits made during recovery; recovery completes before marking done; local queue writes are synchronous. Unit/IndexedDB and Chromium restart tests pass. |
| A10 | P1 | FIXED | IELTS/manual and automatic finalization could continue after an answer save failed. | All manual saves must acknowledge; automatic finalization tolerates only actual backend deadline verdicts (`TEST_TIME_UP`, `MOCK_TIME_UP`, `MOCK_SECTION_TIME_UP`). Transient failure leaves drafts retryable. Submission regressions and browser outage/retry test pass. |
| A11 | P1 | FIXED | Unvalidated upload receipts could release a recording, and `in_progress`/malformed submit receipts could be presented as success. | Speaking requires `saved: true` plus an audio URL; submit schemas require final/grading status. Legacy submit receipts require a finite score. Receipt regressions pass. |
| A12 | P1 | FIXED | Django legacy test submit is not idempotent: retry after a lost response returns `ATTEMPT_FINISHED`. | Fetch the authenticated attempt result and confirm its completed/grading receipt before treating that response as success. Regression covers failed result lookup as well. No nonexistent idempotency endpoint was invented. |
| A13 | P1 | FIXED | Resume dialog existed only in the login branch, disappearing after session restoration; the shared cache was not bound to a student. | Render resume only after authentication and require the owning student ID. Unowned legacy records are retained rather than trusted/deleted; the owner can resume through the authenticated start route. Ownership and full browser restart regressions pass. |
| A14 | P1 | FIXED | `sessionSignature` from Django `mock_attempts.start_response` was dropped by the client while the backend can require `X-Attempt-Signature`. | Preserve the optional response field, persist the signature per attempt, and echo it only to matching mock-attempt routes. API regression plus backend signature tests pass. |
| A15 | P1 | FIXED | Skipping the camera check still left periodic snapshots enabled; legacy runner proctoring defaulted to enabled. | Camera snapshots require explicit opt-in. Mock camera skip disables periodic capture. Real Chromium advances the snapshot window and confirms no further camera requests. Physical camera behavior remains NOT TESTED. |
| A16 | P1 | FIXED | The configured signed updater endpoints included Django responses whose `signature` fields are empty and could shadow the signed release manifest. | Signed updater uses the GitHub signed manifest only; the separate manual-installer channel is preserved. Release configuration regression passes. Actual signed update installation remains NOT TESTED. |
| A17 | P1 | FIXED | Native lockfile contained 11 RustSec vulnerability entries and npm contained three high-severity advisory entries. | Compatible npm patches; rustls 0.23.46, webpki verification/roots patches, Tokio 1.53.3, and updater 2.14.1 with ZIP 9.4.1. The updater patch necessarily updates the compatible Tauri 2 dependency graph. Final npm/RustSec vulnerability counts are zero; full native compilation/tests pass. Informational upstream warnings remain below. |
| A18 | P1 | FIXED | API configuration only warned on remote cleartext HTTP; offline native downloads also accepted remote HTTP. | Credential API destinations require HTTPS except development loopback; credential requests reject redirects. Native media validates schemes/userinfo and enforces HTTPS throughout HTTPS downloads. URL regressions pass without disabling TLS/CSP checks. |
| A19 | P2 | FIXED | Native range parsing accepted malformed/unbounded ranges and whole-file reads could allocate arbitrary memory. | Parse/clamp ranges to 2 MiB; implement suffix ranges; reject invalid requests. Large non-range reads explicitly require ranges instead of truncating/allocating the whole file. Native range/protocol tests pass. |
| A20 | P2 | PARTIAL | Downloading directly over an existing `.bway` file could leave a truncated replacement. | Download to a unique partial file and rename only after successful completion. Compiles and native suite passes; interruption/rename fault injection and real large-video playback were not executed. |
| A21 | P2 | FIXED | Non-ASCII corrupt keyring text could panic during hex decoding. | Reject non-ASCII before byte-indexed slicing. Native corrupted-Unicode regression passes. |
| A22 | P2 | FIXED | Title bar displayed `v0.8.3` despite package/native version 1.0.9; an extra macOS entitlement broke the release gate. | Render the shared app version and assert against package metadata; retain the supported audio-input entitlement. Version/title/release regressions pass. macOS signing/hardware remain NOT TESTED. |
| A23 | P3 | PARTIAL | No routine PR artifact job verified a Windows installer, and no real browser recovery test existed. | Added separate Windows x64 NSIS artifact and Chromium workflows. Local Chromium passes; the Windows workflow has not run because GitHub API access is blocked. No installer or signed-release success is claimed. |

## Backend compatibility evidence

Compared against the unchanged Django implementation:

- API mounts: `config/urls.py` exposes `/v1/` and `/api/v1/`. No evidence established that the documented default API origin is wrong; deployed reachability was blocked by the proxy.
- Authentication: `apps/core/urls.py`, `views.py`, `auth_service.py` confirm login/refresh envelopes, rotation verdicts, authenticated `/auth/logout`, and refresh-bearer `/auth/logout-refresh`.
- Mock start/resume, answers and submission: `mock_attempts.py`, `mock_attempt_views.py`, `mock_submissions.py` confirm payload names, 1–200 bulk-answer limit, session signatures, deadline errors and repeat-submit behavior.
- Legacy tests: `legacy_tests.py` confirms `{ questionId, answer }`, final status/score receipts and the authenticated result lookup used after a repeated submit.
- Speaking: `mock_attempts.py` and `mock_speaking_policy.py` confirm saved/audio URL receipts, duration windows and upload recovery rules. Real microphone encoding/upload-duration end-to-end behavior was not tested.
- Signed updater: `views.desktop_update_check` and `desktop_update_json` return empty signatures. Manual downloads remain separate from signature-verified in-place updates.
- Selected backend tests: **77 passed**, including **18 additional subtests**. Four desktop-update checks used an isolated PostgreSQL 16 container. No production database was contacted.

This establishes selected source/test contract parity, not complete deployment parity for every catalogue, staff, certificate, live-proctor or grading route. No backend source change or backend PR was necessary for the verified client defects.

## Final executed validation

| Command/check | Actual result |
| --- | --- |
| `npm ci --include=dev --no-audit --no-fund` | PASS: frozen lockfile installation |
| `npx tsc --noEmit` | PASS |
| `npm test` | PASS: 47 files, 394 tests; 50 more tests than the original 344-test baseline |
| `npm run build` | PASS; existing deferred splash chunk remains about 1.04 MB before gzip |
| `node --test tools/release-platforms.test.mjs tools/validate-release.test.mjs` | PASS: 17 individual tests |
| `npm run test:e2e` | PASS: 2 real Chromium tests using the repository mock API; camera refusal and API outage are explicit test simulations |
| `cargo check --locked -j 3` | PASS in disposable Linux container with WebKit/GTK prerequisites |
| `cargo clippy --locked -j 3` | PASS, with existing documentation/needless-borrow warnings; not a warnings-as-errors claim |
| `cargo test --locked -j 3` | PASS: 30 native library tests; binary/doc targets contain zero tests and are not counted as coverage |
| `npm audit --json` | PASS: zero advisory entries |
| `cargo-audit audit --file src-tauri/Cargo.lock --json` | Zero vulnerability entries; upstream informational warnings retained |
| Django auth/signature/speaking/recovery suites | 21 tests + 18 subtests passed |
| Django desktop-update suite, isolated PostgreSQL | 4 tests passed |
| Django mock timing/practice/rules/auth-contract suites | 52 tests passed |
| `git diff --check` | PASS |
| Production health/updater GETs | BLOCKED: CONNECT tunnel HTTP 403 from proxy; no application response obtained |
| GitHub PR/issues/Actions reads and PR creation | BLOCKED: API requests returned Forbidden |
| Windows NSIS build/install/uninstall/upgrade | NOT TESTED: workflow prepared; no Windows runner/artifact execution available |
| Physical microphone/camera, OS kiosk controls, signed update installation | NOT TESTED |

Important commands and test targets:

```sh
npm ci --include=dev --no-audit --no-fund
npx tsc --noEmit
npm test
npm run build
node --test tools/release-platforms.test.mjs tools/validate-release.test.mjs
npm audit --json
npm run test:e2e
# Browser validation used Debian Chromium via PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH.
# In a normal machine/CI: npx playwright install --with-deps chromium

# Host has no GTK development libraries. The tested container recipe is retained:
docker build --secret id=proxy_ca,src=/etc/ssl/certs/ca-certificates.crt \
  -f tools/audit/Dockerfile.native -t bw-native-audit:local .
# Native runner mounts the checkout and /workspace/toolchains, sets RUSTUP_HOME,
# CARGO_HOME, CARGO_HTTP_CAINFO and SSL_CERT_FILE to the session CA bundle,
# then executes in src-tauri:
cargo check --locked -j 3
cargo clippy --locked -j 3
cargo test --locked -j 3
cd .. # return to the desktop checkout root
cargo-audit audit --file src-tauri/Cargo.lock --json

# Backend, in /workspace/bestway/backend-django with requirements/dev.txt installed:
pytest tests/test_auth_security.py tests/test_attempt_signature.py \
  tests/test_speaking_response_window.py tests/test_exam_resume_and_partial_submit_v086.py -q
pytest tests/test_desktop_update_and_mobile_auth.py -q
pytest tests/test_mock_attempts.py tests/test_mock_practice.py tests/test_mock_rules.py \
  tests/test_phase3_auth_contract.py -q
```

## Changes and regression coverage

The accompanying `changed-files.txt` contains the complete changed-file list; implementation commits are also inspectable with `git show --stat cda5cf7` and `git show --stat e0e3c49`. Changes cover `src/lib` session/API/OAuth/contracts/offline persistence, the login/exam/resume UI, native session/media modules, security lockfile patches, and isolated validation workflows. The existing Tauri application identifier, deep-link schemes and package version were not changed.

New regression files: `src/lib/api-session.test.ts`, `src/lib/config.test.ts`, `src/lib/legacy-submission.test.ts`, `src/lib/offline-indexeddb.test.ts`, `src/components/ResumeExamModal.test.ts`, and `e2e/student.spec.ts`. Existing session/OAuth/offline/submission/mock/title/release tests and Rust session/media/encryption tests were extended.

## Remaining risks and release gates

- **BLOCKED / upstream:** Linux's GTK3 dependency graph retains `glib` RUSTSEC-2024-0429 (informational unsoundness in Variant string iterators). It cannot be resolved by substituting an incompatible GLib major under GTK/WebKit. Application code does not directly use those iterators; transitive reachability was not proven absent. Seven maintenance-warning entries also remain in proc-macro/DBus dependencies. They are not hidden with ignores.
- **PARTIAL / media threat model:** Existing `.bway` format v1 uses AES-CTR without an authentication tag, and the no-keyring fallback derives from a non-secret machine fingerprint. The format was preserved for compatibility. Do not describe it as tamper-proof or as protection against the local account owner. A versioned authenticated-format/key migration requires separate design and content compatibility testing.
- **NOT TESTED / performance:** Vite reports the deferred splash bundle above 500 kB. No memory benchmark or physical slow-PC measurement was performed; no unrelated redesign was introduced.
- **BLOCKED / deployment access:** `api.github.com`, `api.bestwayec.uz`, and `bestwayec.uz` were saved as additive network requirements in the existing environment configuration draft. Saving the draft did not apply or publish it. Review/save the network changes in environment settings and publish as required by the environment UI, then retry the blocked API/PR/Actions/production checks. No new secret values were requested.
- **NOT TESTED / Windows release:** Run `.github/workflows/windows-validation.yml`, require the nonempty x64 NSIS artifact, and verify clean install, uninstall and upgrade with preserved user data on Windows. This CI artifact intentionally uses the existing manual-installer overlay and does not publish or claim Authenticode signing.
- **NOT TESTED / signed updater:** Verify the repository's secure signing configuration, signed artifacts/manifest and upgrade on a previous installed client before release. No signing key was fabricated, signature verification weakened, or production release published.
- **NOT TESTED / hardware and OS:** Exercise physical microphones, permission denial/retry, recording duration/upload, cameras, Windows/macOS/Linux focus/clipboard/close behavior, display configurations, and Secret Service/keyring persistence. Tauri app controls cannot guarantee OS-level kiosk security.
- **NOT REPRODUCED:** A broken current workflow caused by the unused legacy `/exam-desktop/heartbeat` helper was not established; it has no current call sites. No unsupported endpoint was substituted.

Release decision: the verified fixes are reviewable on the pushed audit branch. A production-readiness claim is withheld until the platform/deployment/signing gates above are completed and residual upstream/media risks are accepted or addressed.
