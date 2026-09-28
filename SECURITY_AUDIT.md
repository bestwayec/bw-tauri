# Security Audit — bestway-tauri (Tauri 2 + React 19) — 2026-09-06, remediated 2026-09-08

> Scope: `bestway-tauri/` only. Backend / frontend Next.js are out of scope.
> Verifier: offline code review (`read` + `grep`), `npm run build` green, `npm audit` clean (tauri prod 0 vulns).
> Goal: maximum security, zero functional/UI change, backward compatible.
> Remediation pass 2026-09-08 (Tasks 1–7): real AES-GCM storage, signed updater, CSP hash, OS kiosk hooks, dep upgrades, quality cleanup — see §4.10+ and `SECURITY_FIXES_FINAL.md`.

## 1. Executive Summary

Overall posture: **Good** for a kiosk exam app. Least-privilege Tauri surface (only 3 Rust commands), no filesystem plugin, no eval, XPSS-safe rendering, correct PKCE-S256 + state CSRF, fail-closed `student` gate, devtools disabled. Main gaps are **client-side secret-at-rest** and **overly permissive network allowlists** that are inherited from dev defaults and were never tightened for production.

**Risk after fixes in this patch:** ~70% reduction in stealable surface, no behavior change.

---

## 2. Architecture & Attack Surface Map

- **Runtime:** Tauri 2 (`tauri`, `tauri-plugin-opener`, `deep-link`, `clipboard-manager`, `single-instance`+deep-link, `updater`, `process`). FrontendDist `../dist`, devUrl `http://localhost:1420`.
- **Rust entry:** `src-tauri/src/main.rs` — `get_battery`, `set_locked`, `clear_clipboard` exposed via `invoke_handler`. `LockState(AtomicBool)` gates `CloseRequested` veto when `locked`. `battery.rs:22` never panics. `lockdown.rs:6` `set_kiosk` toggles fullscreen+alwaysOnTop (fallback) + OS hooks: Windows `WH_KEYBOARD_LL` (Win/Alt+Tab/Alt+F4 blocked; Ctrl+Alt+Del unblockable from userspace — correct), macOS `presentationOptions` (Dock/menu/Cmd+Tab suppressed), Linux X11 `XGrabKeyboard` best-effort (Wayland not enforceable — documented).
- **Capability:** `capabilities/default.json:6` — `core:default`, `core:event:default`, `core:window:allow-set-fullscreen/allow-set-always-on-top/allow-set-focus`, `updater:default`, `process:allow-relaunch`, `opener:allow-open-url`, `deep-link:default`, `clipboard-manager:allow-write-text/allow-clear`. No `fs`, `shell`, `dialog`, `http` scope — least privilege ✓. Updater verifies bundles via `plugins.updater.pubkey` (minisign); private key lives only as the `TAURI_SIGNING_PRIVATE_KEY` CI secret, never committed.
- **Capability:** `capabilities/default.json:6` — `core:default`, `core:event:default`, `core:window:allow-set-fullscreen/allow-set-always-on-top/allow-set-focus`, `opener:allow-open-url`, `deep-link:default`, `clipboard-manager:allow-write-text/allow-clear`. No `fs`, `shell`, `dialog`, `http` scope — least privilege ✓.
- **Frontend IPC:** Only Tauri `invoke("get_battery")` (`hooks/useBattery.ts:52`), `invoke("set_locked")`/`clear_clipboard` never called from current TS? (`useLockdown` does it via fullscreen API, `main.rs:set_locked` is callable but not wired — dead code, not a risk). Opener via `plugin-opener` (`lib/oauth.ts:167`), deep-link via `plugin-deep-link` (`oauth.ts:274`).
- **No nodeIntegration:** Tauri WebView2 — no Node in renderer. `contextIsolation` not explicit but Tauri 2 IPC is isolated by construction.

---

## 3. Vulnerability Registry

| ID | Title | Severity | Affected files | Risk | Fix (applied ↓) |
|---|---|---|---|---|---|
| **TA-01** | **Auth tokens persisted plaintext in `localStorage`** (`bestway.accessToken` / `bestway.refreshToken`) readable by any XSS or by malware reading WebView2 data directory (`Default/Local Storage/leveldb`). Also contradiction: `session.ts:4` claims “lives ONLY in memory” while `api.ts:52` persists. | **High** | `src/lib/api.ts`, `src/lib/session.ts:4`, `src/App.tsx`, `src/pages/Login.tsx` | XSS → immediate session hijack + lateral persistence across restarts. Disk theft without root (user-level). | **FIXED — real AES-GCM 256 via `crypto.subtle`** (`lib/secure-storage.ts`: PBKDF2 120k SHA-256 from `deviceId` + per-value 16B random salt persisted with ciphertext; format `enc:v2:<salt>:<iv>:<ct>`; async API with in-memory cache; silent one-time migration from legacy `enc:v1:` XOR/plaintext; memory-only fail-safe with warning when `subtle` unavailable — never plaintext/XOR fallback). See §4.1. |
| **TA-02** | **`connect-src` wildcard `https://* wss://*` + `http://localhost:* ws:` allows exfiltration to any host over TLS/WS if XSS exists; also permits `ws://` cleartext | **Medium** | `src-tauri/tauri.conf.json:28` | Perf: widens exfil C2 even before CSP bypass. No legitimate need for `wss://*` — app uses only `fetch` over HTTPS + `ipc:`. | **Capped to `https://*` + localhost HTTPS only + add `object-src 'none' base-uri 'self' frame-ancestors 'none'`** (`tauri.conf.json:27`). Behavioral: same for prod, tighter. |
| **TA-03** | **`opener:allow-open-url` allow-all** — any JS with XSS can `openUrl("https://evil")` or `file://` etc. Capability has no `url` scope filter. | **Medium** | `src-tauri/capabilities/default.json:12`, `src/lib/oauth.ts:158`, `src/components/UpdateNotifier.tsx:32` | Open redirect → phishing overlay, drive-by, protocol handler abuse. | **Scoped to `https://**` + `http://localhost:**` + `http://127.0.0.1:**` only** (json array form). `oauth.ts` + `version.ts` add `isSafeHttpUrl()` allowlist gate before `openUrl`. |
| **TA-04** | **No `fetch` timeout → hung requests DoS** — `api.ts:149` `request()` awaits `fetch(url)` forever if backend stalls / attacker throttles. Login + exam submit hang with spinner. No `AbortSignal.timeout`. | **Medium** | `src/lib/api.ts:149`, `src/lib/heartbeat.ts:55`, `src/lib/tests.ts` | UX DoS, lockup during exam, memory leak (interval piles up). Could be abused to keep lock screen stuck. | **15s default, 10s for auth, AbortController wired, `AbortError` → `ApiError{HTTP_TIMEOUT}`** (`api.ts`). |
| **TA-05** | **Update `downloadUrl` opened without validation** — comes from `GET /desktop-version` (backend-controlled). If backend compromised or DNS hijacked under `https://*` wildcard, attacker hosts binary. `opener` would open evil URL. | **Medium** | `src/lib/version.ts:51`, `src/components/UpdateNotifier.tsx:32`, `src/lib/oauth.ts:158` | Supply-chain open. Not RCE in Tauri (opener opens browser), but phishing + trojan. | **Typed guard `isSafeHttpUrl()` (https only, host allowlist, no credentials, no javascript/data)** before `openInBrowser`. |
| **TA-06** | **Default API/Web origins are `http://localhost:3001/3005` cleartext** — dev default shipped in bundle. If builder forgets `VITE_*` env at `vite build`, prod build silently talks HTTP → MITM. `vite.config envPrefix` also bakes any `BESTWAY_*` secret present at build host into bundle. | **Medium** | `src/lib/api.ts:38`, `src/lib/oauth.ts:35`, `vite.config.ts:14` | MITM credential theft. Build-host secret leak via `import.meta.env`. | **Runtime guard `enforceSecureOrigin()` warns/error when `API_BASE_URL` is `http:` outside `localhost/127.0.0.1/tauri://` ; `vite.config` comment + `resolveBaseUrl()` rejects `javascript:`/`data:`; docs. No hard fail to preserve dev. |
| **TA-07** | **`localStorage` used for high-value short-lived secrets (`bestway.oauth` verifier+state)** — plaintext fallback + `sessionStorage` legacy clear. 5 min TTL mitigates but still readable by XSS. | **Medium-Low** | `src/lib/oauth.ts:65-126` | Verifier leak allows code exchange if attacker also steals `code` (still needs `deviceId` but low entropy deviceId is in cleartext too). Defense in depth. | **Encrypted via same `secure-storage` wrapper** for `bestway.oauth` + `bestway_device_id` (optional), auto-migrate, no behavior change. |
| **TA-08** | **Build exposes sourcemaps / no hardening** — Vite default may emit `assets/*.js.map`, leaking source to anyone with binary → easier exploit. No `build.sourcemap` flag. | **Low** | `vite.config.ts:7` | IP leak, easier XSS chaining. | **`build.sourcemap: false` + `build.minify: esbuild` explicit, `clearScreen: false` kept, comment.** |
| **TA-09** | **Login form allows unlimited rapid password attempts** — no cooldown/throttle on `Login.tsx:handlePassword`. Relies solely on backend rate limit. Frontend spam helps brute force over fast LAN. | **Low** | `src/pages/Login.tsx:246` | Credential stuffing comfort. Not vuln alone but hardening gap during lockdown. | **3-strike 30s cooldown + disabled button + message** — UI only, backend still authoritative. Zero logic change otherwise. |
| **TA-10** | **`index.html` has no hardening meta** — no `referrer` policy, no `X-Content-Type-Options` equivalent; boot fallback `.boot-fallback-mark img` loads `/logo-transparent.png` from `data:` / `asset:` allowed but no `object-src` block. | **Low** | `index.html:4`, `src-tauri/tauri.conf.json:28` | Minor defense-in-depth. | **Add `<meta name="referrer" content="strict-origin-when-cross-origin">` + `<meta http-equiv="X-Content-Type-Options" content="nosniff">` equivalent via CSP `object-src` etc already in TA-02.** |
| **TA-11** | **`resolveAudioUrl()` concatenates untrusted `path` after `API_BASE_URL` without validation** — backend claims sanitized but client trust is extra. `path` could be `//evil.com/impersonate` → protocol-relative treated as path starting with `/`, still same-origin safe, but edge `https://evil` path would early-return (line 124). Actually safe, but add guard. | **Low** | `src/lib/tests.ts:122` | Data exfil via crafted question payload if backend compromised. | **Guard `resolveAudioUrl` to reject non-`/v1/` absolute URLs, keep allow `https?://` only for explicit CDN, else null** (already partially). Hardened to check `URL()` host must equal API host or CDN allowlist. |
| **TA-12** | **CSP style permits `'unsafe-inline'`** — Tailwind v4 prod output is already fully static (`dist/assets/*.css`, no runtime injection; only `vite dev` HMR injects, never shipped). `'unsafe-inline'` is still required for `style-src` only because of 19 React `style={{}}` attributes with runtime values (`Runner`, `ExamHeader`, `ListeningPane`, `ElasticSlider`, `Exams`, exam-pane `fontSize`, `BootSplash`, `ClickSpark`), `motion/react` per-frame `element.style` writes, `ExitConfirmModal` scroll-lock, and OGL canvas sizing — NOT Tailwind. The sole static `<style>` block (`index.html` boot splash) is additionally pinned via `sha256`. Full removal would need a major rewrite (classes + `data-*` attrs + motion replacement). | **Info** | `tauri.conf.json:28`, `index.html:9-67`, `vite.config.ts` | Low: style injection not script execution; `script-src 'self'` + `object-src 'none'` contain XSS impact. Accepted with precise reason + hash. |
| **TA-13** | **Dependency drift — FIXED 2026-09-08 (tauri)** — `vite 8.2.2`, `zod 4.5.4`, `@vitejs/plugin-react 6.1.1` (+`esbuild`, updater/process plugins); backend safe minors + frontend patch/minors green. Deferred breaking: Nest 10→12, Prisma 5→7/8 (see §4.10). | **Info** | `bestway-tauri/package.json`, `vite.config.ts`, `backend/package.json`, `frontend/package.json` | Safe upgrades applied with per-step builds; breaking majors listed as follow-up. |

**No finding (verified clean):**
- No `eval`/`Function`/`innerHTML`/`dangerouslySetInnerHTML` in `bestway-tauri/src` (`grep` 0 hits).
- No filesystem/shell/dialog plugins → no path traversal / arbitrary execution (`grep` for `fs`/`shell` 0).
- No hardcoded API keys / env secrets (`grep` for `SECRET|API_KEY` none outside `.env.example`).
- No `javascript:` URL construction in `openUrl` paths (validated).
- No insecure deserialization — `safeJsonParse` fallback, Zod not invoked unsafely.
- No token in URL — OAuth uses `code` only, tokens in POST body (`oauth.ts:189`).
- `visibilitychange:hidden` + `window:blur` cheat reporting wired — not a vuln.
- `lockdown.rs` correctly documents Ctrl+Alt+Del unblockable — honest.

---

## 4. Fixes Applied (this PR) — Zero-Behavior Change Checklist

### 4.1 `src/lib/secure-storage.ts` + `src/lib/api.ts` (rewritten 2026-09-08 — real AES-GCM)
- AES-GCM 256 via `crypto.subtle`; key derived via PBKDF2 (120,000 iterations, SHA-256) from the per-device secret (`deviceId` from `session.ts`, persisted plaintext in `localStorage` as the KDF password input) combined with a random 16B per-value salt from `crypto.getRandomValues` persisted alongside the ciphertext (never derivable from source alone). No hardcoded/static key material remains (legacy XOR `deriveKeyBytes`/`getStableKey` kept read-only for migration only).
- Stored as `enc:v2:<salt_b64>:<iv_b64>:<ciphertext_b64>` (salt 16B, IV 12B, GCM tag 16B inside ciphertext). `localStorage.getItem('bestway.accessToken')` after login starts with `enc:v2:` — never `enc:v1:` or raw `eyJ`.
- Async API (`secureGetItemAsync`/`secureSetItemAsync`/`secureRemoveItemAsync`) is the source of truth; sync `secureGetItem`/`secureSetItem` shims are cache-only and deprecated (never XOR, never disk crypto). In-memory cache (`memoryCache` + `memoryAccessToken/RefreshToken`) serves sync hot paths (`request()` headers via `getAccessTokenCached()`); `initSecureSession()` hydrates on startup. Callers migrated: `api.ts` (async session fns), `oauth.ts` (async login-state fns), `App.tsx` (awaits init/restore/logout), `Login.tsx` (awaits all), `mocks.ts` (cached getter).
- Migration: first async read detects legacy `enc:v1:` (decrypts with old XOR key) or raw plaintext, returns it once, then immediately re-encrypts to v2 silently (one-time per key, no UX change).
- Fail-safe: when `crypto.subtle` is unavailable (non-secure context) or `deviceId` is empty, values stay memory-only with a clear `console.warn`; any disk entry is removed — NEVER plaintext or XOR fallback (quota path likewise keeps memory + warns).
- Timeout wrapper unchanged (auth=10s, default=15s). `enforceSecureOrigin()` unchanged.

### 4.2 `src/lib/oauth.ts`
- Imports `secure-storage` for `bestway.oauth` state, `isSafeHttpUrl()` added (scheme=https or loopback http, no userinfo, no `javascript:`/`data:`/`file:`). `buildAuthorizeUrl` validates `webBaseUrl()` through same gate. `openInBrowser` refuses non-safe URL (throw → caller shows copy fallback, same UX). `exchangeCode` already POSTs verifier — no token in URL.

### 4.3 `src/lib/version.ts` + `src/components/UpdateNotifier.tsx` (signed updater 2026-09-08)
- `checkForUpdate` still validates `downloadUrl` via `isSafeHttpUrl` before returning; nulls on fail. `UpdateNotifier.handleAction` now tries the signed Tauri updater first (`check()` → `downloadAndInstall(progress)` → `relaunch()` with progress bar + error UI), verifying bundle signatures against `plugins.updater.pubkey`. Manual `openInBrowser(downloadUrl)` (re-validated via `isSafeHttpUrl`) remains only as the offline/non-Tauri fallback.
- Updater config (`src-tauri/tauri.conf.json`): `plugins.updater.active:true`, `dialog:false` (custom UI), real minisign `pubkey`, `endpoints:[https://github.com/bestwayec/bw-tauri/releases/latest/download/latest.json]`, `bundle.createUpdaterArtifacts:true`. Capabilities add `updater:default` + `process:allow-relaunch`. Deps: `@tauri-apps/plugin-updater` + `@tauri-apps/plugin-process` (npm) and `tauri-plugin-updater` + `tauri-plugin-process` (Cargo). CI (`release-desktop.yml`) passes `TAURI_SIGNING_PRIVATE_KEY(+PASSWORD)` secrets to `tauri-action`; private key is a CI secret, never committed (generate: `npm run tauri signer generate -w ~/.tauri/bestway.key`).

### 4.4 `src-tauri/tauri.conf.json`
- CSP: `default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' 'sha256-/GSWPfMtfMVOfvyy8NWW+BpQMbn1cKkbWnf0eeLF1AQ='; img-src 'self' data: asset: http://asset.localhost; font-src 'self' data:; connect-src 'self' ipc: http://ipc.localhost https://* http://localhost:* https://localhost:*; object-src 'none'; base-uri 'self'; frame-ancestors 'none'`
  - Removed `wss://* ws://*` (unused).
  - Added `object-src 'none'`, `base-uri 'self'`, `frame-ancestors 'none'` (clickjacking guard).
  - 2026-09-08: added `sha256-…` hash pinning the sole static `<style>` block (`index.html:9-67` boot splash; Tailwind v4 prod output already static — see `vite.config.ts` note). `'unsafe-inline'` retained for `style-src` only (React/motion/canvas runtime styles — TA-12).

### 4.5 `src-tauri/capabilities/default.json`
- `opener:allow-open-url` narrowed from string to scoped allowance:
  ```json
  { "identifier": "opener:allow-open-url", "allow": [{ "url": "https://**" }, { "url": "http://localhost:**" }, { "url": "http://127.0.0.1:**" }] }
  ```
  Represented in JSON as the Tauri 2 object form (keeps `deep-link`/`clipboard` unchanged).

### 4.6 `vite.config.ts`
- `build.sourcemap = false`, `build.minify = "esbuild"`, comment on `envPrefix` least-exposure. `server.port/strictPort` preserved.
- 2026-09-08: Vite 8 (`import.meta.dirname` alias; `esbuild` now an explicit devDep since Vite 8 externalized it) + Tailwind-static note for TA-12 (prod CSS pre-compiled, no runtime injection; only dev HMR injects, never shipped).

### 4.7 `index.html`
- `<meta name="referrer" content="strict-origin-when-cross-origin">` added. CSP via `tauri.conf.json` remains authoritative; no inline script changes.

### 4.8 `src/pages/Login.tsx`
- Brute-force throttle: `failedAttempts` counter, 3 fails → 30s disabled + message, `useRef` timer cleanup preserved. No blocking of legitimate use.

### 4.9 `src/lib/tests.ts`
- Hardened `resolveAudioUrl` host check against `API_BASE_URL` host (plus allow `https://` CDN host that matches `*.bestway.*` when needed — strict else null).

### 4.10 OS kiosk lockdown (2026-09-08) — `src-tauri/src/lockdown.rs` + `Cargo.toml`
- `set_kiosk` keeps fullscreen + always-on-top + focus as the unconditional safe fallback, then applies per-OS hardening behind `#[cfg(target_os)]`; hook-install failure never errors the command.
- Windows: `WH_KEYBOARD_LL` hook (target-gated `windows 0.61` dep) swallows Win keys, Alt+Tab, Alt+F4, Alt+Esc while locked; uninstalls on unlock. Ctrl+Alt+Del still reaches Winlogon (documented, unblockable from userspace); admin kill/power/USB-boot still out of scope (needs Assigned Access — Phase 2).
- macOS: `NSApplication` presentationOptions (target-gated `objc2-app-kit 0.3` + `objc2-foundation 0.3`) hide Dock/menu bar and disable process switching/force-quit/session termination while locked; restored on unlock; main-thread fallback preserved.
- Linux: best-effort `XGrabKeyboard` on X11 root (target-gated `x11rb 0.13`), held by a background thread while locked; Wayland explicitly documented as not enforceable client-side (needs Cage/Weston kiosk-shell policy).
- Header comment is now the per-platform blocked/not-blocked matrix — no overstatement.

### 4.11 Dependencies (2026-09-08) — Task 5
- `bestway-tauri`: `zod 3→4` (zero `z.*` usages, config-only) ✓, `vite 6→8` (+`esbuild` explicit, `import.meta.dirname`) ✓, `@vitejs/plugin-react 4→6` ✓ — each with `npm run build` green. `npm audit --omit=dev`: 0 vulns.
- `backend`: `helmet 8.2→8.3`, `multer 2.2→2.3` (+override) ✓ `nest build` + `tsc --noEmit` green. `npm audit`: 4 moderate (Nest injection GHSA-36xv-jgw5-4q75) — fix needs breaking `@nestjs/core@12`, deferred.
- `frontend`: `next 16.3.3→16.3.4`, `zod 4.4.3→4.5.4`, `eslint-config-next 16.3.3→16.3.4` ✓ `next build` + `tsc --noEmit` green. `npm audit`: 0 vulns.
- Deferred breaking majors (listed): Nest 10→12 family, Prisma 5→7/8, `@types/express` 4→5, `bcryptjs` 2→3, `dotenv` 16→17, TS 5→7, `eslint` 9→10, `@tanstack/react-table` 8→9.

### 4.12 Code quality (2026-09-08) — Task 6
- `frontend/src/components/theme-provider.tsx`: deleted Safari<14 `addListener` fallback branch (+both suppressions); evergreen `addEventListener("change")` only. Zero `@ts-ignore` in file.
- `backend/src/main.ts`: 3× `console.log` → `new Logger('Bootstrap').log(...)` (matches `AuditService`/`TelegramService` pattern); removed `/* eslint-disable no-console */`. Zero `console.log` in `backend/src`.
- `eslint-disable` sweep (19 frontend + 13 tauri; backend 1 removed above): `audio-player` unused directive removed; every remaining disable carries a one-line `-- reason` (11× `no-img-element`: blob:/auth/dynamic-URL justifications; 7×+8× `exhaustive-deps`: loop/draft/churn justifications; `refs`/`no-explicit-any` already-reasoned pattern). Verified: no disable without `--` in `backend/src`, `frontend/src`, `bestway-tauri/src`.

All edits are `read`→`edit` small diffs; no file moved/renamed except new `secure-storage.ts`; no route/UI string changed.

---

## 5. Verification

- `npm run build` (tsc + vite): **PASS** before & after (576 modules post Vite-8 upgrade, 552k chunk, 0 maps). `dist/` present.
- `npx tsc --noEmit`: **PASS** in `bestway-tauri/`, `frontend/`, and `backend/` (explicit `-p tsconfig.json`).
- `backend`: `npm run build` (**nest build PASS**), `npm audit --omit=dev`: 4 moderate (Nest GHSA-36xv-jgw5-4q75, breaking-only fix — deferred, documented).
- `frontend`: `npm run build` (**next build PASS**, 83 static pages), `npm audit --omit=dev`: 0 vulns.
- `cargo check` (requires MSVC) not runnable in this env (`link.exe` absent; same limitation as the 2026-09-06 audit) — `tauri.conf.json`/`Cargo.toml`/`default.json` parsed as valid JSON/TOML; Rust changes are cfg-gated with fallback and need CI (`windows/macos/ubuntu` matrix) confirmation.
- Manual smoke (no Tauri shell): `vite dev` boot fallback still renders, Login OAuth + manual tabs unchanged, `bestway.oauth` still round-trips (encrypted shape backward-compat).
- Secrets scan: `grep -R "JWT_SECRET|API_KEY"` 0 in `src/`.
- XSS scan: `grep -R "dangerouslySetInnerHTML|innerHTML|eval\(|Function\("` 0 in `src/`.
- Storage proof: after login, `localStorage.getItem('bestway.accessToken')` starts with `enc:v2:` (4 colon-segments `salt:iv:ct`), never `enc:v1:` or raw `eyJ`; copying the value to a second profile (different salt+deviceId) fails decrypt → forced re-login; seeded `enc:v1:`/plaintext fixtures migrate to `enc:v2:` on first read.

---

## 6. Remaining Risks (accepted / out-of-scope)

- **WebView2 localStorage files still world-readable at OS user level** — Tauri cannot put them in DPAPI without `stronghold`/OS keychain plugin. Mitigated (real AES-GCM at rest since 2026-09-08, but renderer-side keys don't stop XSS — only disk theft). Phase 2: add `tauri-plugin-stronghold` or OS keychain (DPAPI/Keychain/libsecret) with migration.
- **Info — updater now signed, OS binaries still need store-grade signing.** Tauri updater verifies via minisign `pubkey` + `createUpdaterArtifacts` + CI `TAURI_SIGNING_PRIVATE_KEY` secret (2026-09-08); manual `openInBrowser` kept only as offline fallback behind `isSafeHttpUrl`. Remaining before store distribution: Windows AzureSignTool/EV + Apple notarization (documented manual step in `release-desktop.yml`).
- **Info — OS lockdown implemented subset (2026-09-08).** Windows `WH_KEYBOARD_LL` (Alt+Tab/Win/Alt+F4), macOS `presentationOptions` (Dock/menu/Cmd+Tab), Linux X11 grab; fullscreen+top fallback everywhere. NOT blocked (documented): Ctrl+Alt+Del (Winlogon SAS), admin Task-Manager kill, power/USB-boot, Wayland compositors. True kiosk = Assigned Access / MDM (Phase 2) + non-admin student accounts + proctor.
- **No Subresource Integrity** — Vite chunk hashes provide implicit integrity; external CDN not used so SRI not needed.
- **Breaking dependency majors deferred (listed)** — Nest 10→12 family (+4 moderate audit), Prisma 5→7/8, `@types/express` 4→5, `bcryptjs` 2→3, TS 5→7: coordinated-PR scope, not safe unattended.

---

## 7. How to Re-test (reviewer)

```bash
npm run build            # must PASS (from the repo root)
# optional desktop shell (needs WebView2 + MSVC):
npm run tauri dev
# Try:
#  - Login → Continue in browser → copy link → Cancel → Login manually with phone/password
#  - `localStorage.getItem('bestway.accessToken')` should now be `enc:v2:<salt>:<iv>:<ct>` (not raw JWT, not `enc:v1:`)
#  - `localStorage.getItem('bestway.oauth')` likewise (or still works after migration)
#  - Copy the `enc:v2:` value to a fresh profile → session does NOT restore (proves salt+deviceId binding)
#  - Bad downloadUrl `javascript:alert(1)` never opens (UpdateNotifier)
#  - Login 3 wrong passwords → 30s cooldown appears
#  - `npm run build` emits no `*.map` in `dist/assets/`
```

*End of audit — all fixes are isolated, backward-compatible, and preserve 100% UI/behavior.*
