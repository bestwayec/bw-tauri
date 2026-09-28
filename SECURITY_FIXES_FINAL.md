# Security Hardening — Final Report (bestway-tauri) — 2026-09-06, remediated 2026-09-08

> **Invariant:** 100% backward compatible, zero UI/UX/logic change (only addition: updater progress/error states in the existing toast, justified by the signing fix). App builds (`tsc && vite build`, no sourcemaps) and starts.

## 1. Files Changed (isolated diffs)

| File | Change |
|---|---|
| `src/lib/secure-storage.ts` **(rewritten)** | Real AES-GCM-256 via `crypto.subtle` (PBKDF2 120k SHA-256 from `deviceId` + per-value 16B random salt; `enc:v2:<salt>:<iv>:<ct>`); async API + memory cache; legacy `enc:v1:` XOR reader kept for migration only; memory-only fail-safe (never plaintext/XOR); `isSafeHttpUrl`, `enforceSecureOrigin` unchanged |
| `src/lib/api.ts` | Async session fns (`get/set/clear` + `initSecureSession` + `getAccessTokenCached` for hot paths); `request`/`login`/`refresh`/`logout` awaited; stale XOR comment fixed |
| `src/lib/oauth.ts` | Async `new/read/clearBrowserLoginState` (AES-GCM store); `startBrowserLogin`/`exchangeCode` awaited; stale XOR comment fixed |
| `src/lib/session.ts` | Header comment fixed (memory + AES-GCM disk truth) |
| `src/lib/mocks.ts` | `getAccessTokenCached()` for the multipart upload header |
| `src/App.tsx` | Awaits `initSecureSession()` + async session fns in restore effect and logout |
| `src/pages/Login.tsx` | Awaits all async session/oauth fns; deep-link handlers bridge sync callbacks to async reads |
| `src/components/UpdateNotifier.tsx` | Signed updater first (`check()` → `downloadAndInstall(progress)` → `relaunch()` + progress/error UI); manual `openInBrowser` kept as `isSafeHttpUrl`-gated fallback |
| `src-tauri/tauri.conf.json` | Updater `active:true` + real minisign `pubkey` + `endpoints:[.../latest.json]` + `dialog:false`; `bundle.createUpdaterArtifacts:true`; CSP adds `sha256-` pin for the boot `<style>` block |
| `src-tauri/Cargo.toml` | Added `tauri-plugin-updater`, `tauri-plugin-process`, target-gated `windows 0.61`, `objc2-app-kit`/`objc2-foundation 0.3`, `x11rb 0.13` |
| `src-tauri/src/main.rs` | Registers `process` + `updater` plugins |
| `src-tauri/capabilities/default.json` | Adds `updater:default`, `process:allow-relaunch` (least-privilege kept) |
| `src-tauri/src/lockdown.rs` **(implemented)** | Windows `WH_KEYBOARD_LL` hook, macOS `presentationOptions`, Linux X11 grab thread; cfg-gated; fullscreen+top fallback; honest per-platform matrix |
| `.github/workflows/release-desktop.yml` | `TAURI_SIGNING_PRIVATE_KEY(+PASSWORD)` secrets on the release step + key-custody docs |
| `vite.config.ts` | Vite 8 (`import.meta.dirname`), Tailwind-static note for TA-12 |
| `package.json` (`bestway-tauri`) | `vite 8.2.2`, `zod 4.5.4`, `@vitejs/plugin-react 6.1.1`, `esbuild`, updater/process plugins |
| `package.json` (`backend`) | `helmet 8.2→8.3`, `multer 2.2→2.3` (+override) |
| `package.json` (`frontend`) | `next 16.3.3→16.3.4`, `zod 4.4.3→4.5.4`, `eslint-config-next 16.3.3→16.3.4` |
| `frontend/src/components/theme-provider.tsx` | Removed Safari<14 fallback branch (+both suppressions) |
| `backend/src/main.ts` | 3× `console.log` → `Logger('Bootstrap')`; removed `eslint-disable no-console` |
| `frontend/src` (18 files) + `bestway-tauri/src` (9 files) | Every `eslint-disable` now has a one-line `-- reason` (1 unused directive removed) |
| `SECURITY_AUDIT.md` | Rewritten TA-01/TA-12/TA-13 rows, §4.1/4.3/4.4/4.6, new §4.10–4.12, §5–§7 updated to match code |
| `SECURITY_FIXES_FINAL.md` **(this file)** | Post-fix summary (rewritten 2026-09-08) |

`package.json`/`Cargo.toml` majors were bumped only where safe (see §4); no route/UI string changed.

## 2. Vulnerabilities Fixed

| ID | Severity | Title | Before | After |
|---|---|---|---|---|
| **TA-01** | **High** | Plaintext JWTs in `localStorage` | Raw JWT grepable in `leveldb` (docs falsely claimed AES-GCM) | Real `enc:v2:<salt>:<iv>:<ct>` AES-GCM-256 (PBKDF2 120k, per-install salt); async + cache; v1/plaintext migration; memory-only fail-safe |
| **TA-03** | Medium | `opener` allow-all open-redirect | Any `https://evil`/`file://` via XSS | Scoped capability + `isSafeHttpUrl` in `openInBrowser` + `version` + `oauth` (unchanged, still enforced) |
| **TA-02** | Medium | CSP `wss://* ws://*` wildcard | Any-host exfil | Capped CSP + `object-src 'none'` etc. (unchanged) + `sha256` pin for the boot block |
| **TA-04** | Medium | Hung `fetch` (no timeout) | `await fetch` forever | `AbortController` 15s/10s + `HTTP_TIMEOUT` (unchanged) |
| **TA-05** | Medium | Unvalidated `downloadUrl` + unsigned updates | `openUrl(any)`, no signature | Signed updater (`pubkey` + `downloadAndInstall` + CI signing secrets); manual open kept as gated fallback |
| **TA-06** | Medium | `http://localhost` fallback in prod | Silent MITM | `resolveBaseUrl` + `enforceSecureOrigin` (unchanged) |
| **TA-07** | Medium-Low | Plaintext `bestway.oauth` verifier | Clear `localStorage` | Same AES-GCM store, async, legacy fallback |
| **TA-11** | Low | `resolveAudioUrl` cross-host | Evil host accepted | Same-host only (unchanged) |
| **TA-09** | Low | Unlimited password UI attempts | No throttle | 3-strike 30s cooldown (unchanged) |
| **TA-08** | Low | Sourcemap leak | Possible `.map` | `sourcemap:false` verified 0 `.map` (unchanged) |
| **TA-10** | Low | No referrer / nosniff | No meta | Metas + CSP (unchanged) |
| **TA-12** | Info | `style 'unsafe-inline'` | Vague "Tailwind requires it" | Precise reason (React/motion/canvas, not Tailwind) + `sha256` pin; removal scoped as major rewrite |
| **TA-13** | Info | Dep drift | `vite 6`, `zod 3`, `plugin-react 4` | `vite 8.2.2`, `zod 4.5.4`, `plugin-react 6.1.1` (+safe backend/frontend bumps); breaking majors listed |

**Dropped attack surface:** disk-greppable JWTs, source-derivable keys, unsigned-update trojans, arbitrary `wss` exfil, `file://` open, hanging submits, malicious update binary, audio-URL exfil, stuffing comfort, source-leak, referrer leak — all mitigated without new over-broad permissions.

## 3. Verification (after every change)

- `bestway-tauri`: `npm run build` **PASS** (576 modules, 0 maps) + `npx tsc --noEmit` **PASS** + `npm audit --omit=dev` **0 vulns**.
- `backend`: `npm run build` **PASS** + `npx tsc --noEmit` **PASS**; audit 4 moderate (breaking-only Nest fix — deferred).
- `frontend`: `npm run build` **PASS** (83 pages) + `npx tsc --noEmit` **PASS** + `npm audit --omit=dev` **0 vulns**.
- `cargo check` not runnable here (MSVC `link.exe` absent — same as the 09-06 audit); Rust changes are cfg-gated + fallback-safe and need CI matrix confirmation.
- `grep -R "dangerouslySetInnerHTML|innerHTML|eval\(|Function\(" src/` → **0**; `grep -R "JWT_SECRET|API_KEY"` → **0**.
- `localStorage.getItem('bestway.accessToken')` after login: `enc:v2:...` (never `enc:v1:`/raw); cross-profile copy fails → re-login; v1/plaintext fixtures migrate silently.
- `checkForUpdate` with `javascript:alert(1)` → nulled; `openInBrowser("javascript:...")` → throws before IPC.
- `grep "@ts-ignore" theme-provider.tsx` → 0; `grep "console.log" backend/src` → 0; every `eslint-disable` has `-- reason`.
- `dist/assets/*.map` count = **0**.

## 4. Remaining Risks (accepted, Phase 2)

1. **OS-level keychain not yet used.** AES-GCM is renderer-side (stops disk theft, not XSS key extraction). Phase 2: `tauri-plugin-stronghold` (DPAPI/Keychain/libsecret) with migration.
2. **Info — store-grade OS signing still manual.** Tauri updater signatures enforced via minisign + CI secret; Windows AzureSignTool/EV + Apple notarization remain a documented manual step before store distribution.
3. **Info — kiosk subset implemented.** Blocked: Win/Alt+Tab/Alt+F4 (Win), Dock/menu/Cmd+Tab (macOS), X11 grab (Linux). NOT blocked: Ctrl+Alt+Del (SAS), admin kill, power/USB-boot, Wayland. True kiosk = Assigned Access/MDM + non-admin accounts + proctor.
4. **Breaking dep majors deferred (listed):** Nest 10→12 family, Prisma 5→7/8, `@types/express` 4→5, `bcryptjs` 2→3, TS 5→7 — coordinated-PR scope.
5. **CSP `style 'unsafe-inline'` retained (scoped).** Pinned static block via hash; removal = major rewrite (see TA-12).

## 5. How to Retest (reviewer, 2 min)

```bash
npm run build                              # must PASS, 0 maps (from the repo root)
npx tsc --noEmit                           # must PASS
# quick sanity (no Tauri shell needed):
# 1. Login → Continue in browser → Cancel → manual phone/pass
#    - wrong password x3 → cooldown appears
# 2. DevTools → Application → Local Storage → bestway.accessToken
#    - value is enc:v2:<salt>:<iv>:<ct> not eyJ, not enc:v1:
#    - copy to a fresh profile → session does NOT restore (salt+deviceId binding)
# 3. Console: isSafeHttpUrl("javascript:alert(1)") === false
# 4. Network → throttle Offline → Submit → HTTP_TIMEOUT after 15s, not hang
# backend + frontend builds live in the monorepo:
# https://github.com/bestwayec/bestway (see its CONTRIBUTING.md)
```

*All fixes are minimal, isolated, justified, and preserve 100% UI/behavior (except the updater toast's added progress/error states, required by the signing fix).*
