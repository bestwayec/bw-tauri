# Security Policy

## Supported Versions

| Version | Supported          |
| ------- | ------------------ |
| 0.3.x   | :white_check_mark: |
| 0.2.x   | :white_check_mark: (migration only — update to 0.3.x) |
| < 0.2   | :x:                |

Only the `main` branch receives updates. Version files kept in sync: `package.json`, `package-lock.json`, `src-tauri/tauri.conf.json`, `src-tauri/Cargo.toml`, `src-tauri/Cargo.lock`.

## Scope (this repo only)

- Tauri 2 kiosk exam client: AES-GCM `secure-storage` (`enc:v2`, see `src/lib/secure-storage.ts`)
- Signed auto-updater (`src-tauri/tauri.conf.json` → `plugins.updater.pubkey`, minisign format)
- Per-platform lockdown matrix (`src-tauri/src/lockdown.rs`): Windows `WH_KEYBOARD_LL` hook, macOS `presentationOptions`, Linux X11 grab (best-effort); Ctrl+Alt+Del, admin kill, power/USB-boot, and Wayland compositors are NOT blockable client-side — true kiosk needs Assigned Access / MDM
- CSP + capability review (`src-tauri/tauri.conf.json`, `src-tauri/capabilities/default.json`)

Audits: `SECURITY_AUDIT.md`, `SECURITY_FIXES_FINAL.md`. The backend API and web frontend live in `https://github.com/bestwayec/bestway` and are out of scope here.

## Updater signing key custody

- The Tauri updater public key lives in `src-tauri/tauri.conf.json` (`plugins.updater.pubkey`, minisign format).
- The private key MUST be stored only as the `TAURI_SIGNING_PRIVATE_KEY` (+ optional `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`) GitHub Actions secret — never committed. Generate: `npm run tauri signer generate -w ~/.tauri/bestway.key`, then `gh secret set TAURI_SIGNING_PRIVATE_KEY < ~/.tauri/bestway.key`. Rotate by regenerating + updating `pubkey` + shipping one manual update.

## Reporting a Vulnerability

Do NOT open a public issue for vulnerabilities. Report via a private GitHub Security Advisory (`https://github.com/bestwayec/bw-tauri/security/advisories/new`) or email `otashdev1@gmail.com`.

- 48 soat ichida javob beramiz.
- Tasdiqlangan kamchiliklar 7 kun ichida tuzatiladi va yangi reliz chiqariladi.
- Iltimos, kamchilik ommaga oshkor bo'lmasdan oldin tuzatishga vaqt bering.

## Secrets

Hech qachon `.env`, `*.key`, `*.pem` ni commit qilmang. `TAURI_SIGNING_PRIVATE_KEY` qiymati faqat GitHub Actions secret'ida saqlanadi va `.gitignore` bilan himoyalangan.

## Supply chain

- `.github/workflows` dagi action'lar full commit SHA ga pinned; `GITHUB_TOKEN` default `contents: read`, faqat release build job'da `contents: write`.
- Release artefaktlari imzolangan (`latest.json` + bundle'lar minisign bilan tekshiriladi).
