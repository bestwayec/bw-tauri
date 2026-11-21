# BESTWAY NEXT — Stage 06 release verification (desktop + Android)

Session 2026-11-21. Branch `feat/bestway-next-stage05-completion`,
[bestwayec/bw-tauri#39](https://github.com/bestwayec/bw-tauri/pull/39). Companion
[bestwayec/bestway#207](https://github.com/bestwayec/bestway/pull/207).

**Outcome: MERGE BLOCKED (release precheck) · RELEASE BLOCKED.** Nothing was merged, tagged or
published. The code is pushed and green; the blockers are signing, notarization and physical-device
gates that cannot be satisfied from this environment and must not be faked.

## 1. Version state (checked on GitHub, not assumed)

| Item | Value |
| --- | --- |
| Latest published release | `v1.0.12` (published 2026-11-19, tag commit `900c563`) |
| Next free version | `1.0.13` — no `v1.0.13` tag exists (`git ls-remote --tags`) |
| Version files on this branch | still `1.0.12` (`package.json`, `Cargo.toml`, `tauri.conf.json`, Android `versionName 1.0.12` / `versionCode 10120`). Not bumped, because no release is being cut. |

## 2. Release precheck (06.2)

| # | Gate | Status | Evidence |
| --- | --- | --- | --- |
| 1 | PRs contain the final implementation | PASS | heads pushed; see §5 |
| 2 | No unresolved P0 security defect | PASS | plaintext token fallback removed (`c3ec47b`); live cross-account probe all denied |
| 3 | Backend migration checks | PASS | no migration in this round; Prisma ledger + Django migrate + legacy upgrade scripts PASS |
| 4 | Final heads green in hosted CI | PASS for every completed run (see PR checks) |
| 5 | API contract compatibility | PASS | no endpoint/payload change; 1.0.12 desktop keeps working with the new backend; `session_set` IPC change is internal to the desktop bundle |
| 6 | Protected session persistence safe | PASS | §3 |
| 7 | Native upgrade/recovery acceptance documented | PARTIAL | upgrade path unit-tested on all OSes and natively on Windows CI; no physical device run |
| 8 | Required signing credentials exist | **UNVERIFIED** | repository secrets cannot be listed from this session; the workflow references `TAURI_SIGNING_PRIVATE_KEY(_PASSWORD)` and `ANDROID_KEYSTORE_*` only |
| 9 | Official Android certificate matches the previously published APK | **BLOCKED** | `v1.0.12` has **no APK asset** on GitHub, so there is no published certificate to compare against here |
| 10 | Updater signatures match the installed public key | PARTIAL | `tauri.conf.json` pubkey key-id `D2DABB961B2CD8F2`; v1.0.12 ships `.sig` files and `latest.json`, but verifying a new signature requires a new signed build |
| 11 | Artifacts for every supported target | **BLOCKED** | macOS bundles are **ad-hoc signed, not notarized** (the workflow itself logs "ad-hoc signature, no notarization claim"); no Apple Developer ID or notarization credentials are referenced anywhere. Windows NSIS has **no Authenticode signing** (only the Tauri updater signature) |
| 12 | Rollback and monitoring ready | PARTIAL | rollback documented below; no production monitoring hook verified |

Because gates 8–11 cannot pass, the owner's conditional authorization does not extend to merging,
deploying or publishing. Releasing anyway would ship macOS builds that Gatekeeper blocks and Windows
installers that SmartScreen flags as unknown, as a "complete" stable release — the brief forbids this.

### Updater manifest finding (published v1.0.12)

The live `https://github.com/bestwayec/bw-tauri/releases/download/v1.0.12/latest.json` contains only
`darwin-x86_64` / `darwin-x86_64-app` (both signed with key `D2DABB961B2CD8F2`). There is no
`windows-x86_64`, `linux-x86_64` or `darwin-aarch64` entry, although their `.sig` files were uploaded:
the manifest was written by parallel build jobs and the last writer won. Installed 1.0.12 apps on
Windows, Linux and Apple Silicon therefore cannot find an update through the manifest; the next release
must be announced for a manual install on those platforms. The current workflow already fixes the cause:
`includeUpdaterJson: false` in the build matrix and a single `tools/publish-updater-manifest.mjs` step
after every platform uploads, which fails the release if any platform bundle or signature is missing
(`node --test tools/publish-updater-manifest.test.mjs tools/updater-manifest.test.mjs`: 4/4 pass).

## 3. Session token storage (P0) — what changed and what was verified

Before (≤ 1.0.12): when the OS credential store failed, the access and refresh tokens were written to
`session.json` (0600 on unix, plain JSON) in the app data directory.

Now (`c3ec47b`):

- Tokens are stored only in the OS credential store, and only after a fresh-handle read-back returns
  the exact written value.
- No usable store → **memory-only** session: works until exit, sign-in required after restart, no file
  write. The UI shows a localized notice (`SessionPersistenceNotice`).
- Upgrade: a legacy `session.json` (and `session.json.tmp`) is migrated into the store when possible,
  kept in memory for the current run otherwise, and **deleted in every case**. A protected session wins
  over a stale file; a corrupt protected payload is discarded.
- No custom cryptography or fixed keys. Logs contain keyring error text only (checked: keyring's
  `BadEncoding` Display never prints bytes).

Tests (`cargo test --lib`, 40 pass on Linux): restart restores the rotated pair; unavailable store keeps
tokens in memory and writes nothing containing a token; a store that acknowledges but does not return
writes is memory-only; legacy file migrates and is removed; legacy file is removed without a store;
protected session beats a stale file; corrupt payload discarded; account switch replaces the secret;
logout clears it. Windows CI ran the real Credential Manager test (now also covering legacy migration)
on [`c3ec47b`](https://github.com/bestwayec/bw-tauri/actions/runs/44879070238) and
[`ac22eb8`](https://github.com/bestwayec/bw-tauri/actions/runs/44879377327): PASS.

Not changed, documented: the browser-only fallback (`src/lib/secure-storage.ts`, used when the desktop
frontend runs in a plain browser, e.g. dev/validation) derives its AES key from a locally stored device
id — this is obfuscation, not protection, and is not used by the Tauri app. Android keeps only the
5-minute single-use PKCE state in app-private preferences; the session is the WebView's HttpOnly
cookies inside the app sandbox.

## 4. Native acceptance by platform

| Platform | Executed this session | Status |
| --- | --- | --- |
| Windows x64 | hosted runner: Rust tests incl. native keyring, NSIS build, clean install + launch + WebView2 evidence | PARTIAL — no physical Windows 10 / 4 GB, no signed-update run |
| Linux x64 | Rust tests + clippy (local, CI); browser-build journeys against real Django | PARTIAL — packaged DEB/AppImage login not re-run |
| macOS Intel / Apple Silicon | none (no macOS host) | UNVERIFIED; release builds are not notarized |
| Android | CI: unit tests, release assemble, emulator install + launch (offline) | PARTIAL — no physical device, no authenticated journey, no signer comparison |

Real-backend desktop journeys (browser build of this app → local Django + PostgreSQL), script
`e2e/real-backend/vocabulary-cross-client.cjs`:

```
teacher created and assigned: true
downloaded for offline: true
offline change queued: true
after offline restart: {"status":"ready","pending":1,"snapshot":true}
sync result: {"first":{"acknowledgedCount":1,"remainingCount":0},"replay":{"acknowledgedCount":0,"remainingCount":0},"pending":0}
server revision before/after: [0,1]
desktop result: 100%
teacher web report: {"completed":1,"percentage":100}
teacher desktop-client report: {"completed":1,"percentage":100}
```

"Restart" here is a browser-process restart with the API unreachable (IndexedDB persisted); the packaged
Tauri restart with the Rust keyring is covered by unit/CI tests above, not by a device run.

## 5. Owner release runbook (when gates 8–11 are resolved)

1. Provide signing material as repository secrets (never in chat): Apple Developer ID certificate +
   notarization credentials (and add notarization to `release-desktop.yml`), a Windows code-signing
   certificate (and wire `signCommand`/`certificateThumbprint`), confirm `TAURI_SIGNING_PRIVATE_KEY`
   matches pubkey `D2DABB961B2CD8F2`, and the Android keystore whose SHA-256 signer matches the app
   users already have installed.
2. Run the physical checklist in `BESTWAY_NEXT_NATIVE_ACCEPTANCE.md` (Windows 10 / 4 GB, Android device,
   Linux packaged, macOS both architectures).
3. Merge bestwayec/bestway#207, deploy with the existing `deploy-django.yml` after a database backup, smoke-check.
4. Merge bestwayec/bw-tauri#39; bump the five version files and Android `versionCode` to `1.0.13` / `10130`;
   tag `v1.0.13` on the merged main commit; let `release-desktop.yml` (which requires the Android job)
   publish.
5. Verify `latest.json`, each `.sig` against the pubkey, download links and that GitHub "Latest" is
   `v1.0.13`.

Rollback: stop promoting the release / delete the draft; 1.0.12 clients read the same keyring entry.
A 1.0.13 client that ran memory-only has no file to roll back.
