# Bestway Exam — Tauri Desktop (students only)

Secure desktop app for education-center students to take exams. Admin locks everyone into the app — no cheating, no other apps.

> Standalone repo (`bestwayec/bw-tauri`). The backend API is an external dependency — this app talks directly to `VITE_API_URL` (default `http://localhost:3001/v1`). Backend source and the API contract live in the monorepo: `https://github.com/bestwayec/bestway/blob/main/backend/api-contract.md`.

## Frozen contract (must never change)

- Deep-link scheme: `bestway-exam://` (system-browser login callback + OAuth code exchange)
- Tauri application identifier: `uz.bestway.exam`

Installed clients, the backend OAuth redirect, and the auto-updater all depend on these two values. Changing either one breaks login and updates for every deployed client.

## Features

- Student login via **web browser (OAuth-style)** + password fallback (`role=student`)
- Black pro UI: `ClickSpark` click bursts + `CursorTrail` cursor glow/sparks
- Tests + Mock exams (IELTS / multilevel, speaking audio)
- Live remote control: admin Lock / Unlock / Force-submit, roster with online + cheat count
- Strong app-level lockdown: fullscreen kiosk, always-on-top, no taskbar, shortcut + clipboard block, focus-loss auto-report (`flag-cheat`), 15s heartbeat, timer auto-submit
- **Battery % bottom-right**: `BatteryIndicator` in the status bar shows the laptop/PC battery (`get_battery` → `navigator.getBattery()` → `—%`), red <20%, amber <40%, plug icon when charging, click to refresh, `uz/en`
- Online-only v1 (auto banner + queued submit on disconnect)
- Signed auto-updates from `https://github.com/bestwayec/bw-tauri/releases/latest/download/latest.json` (minisign `pubkey` in `src-tauri/tauri.conf.json`)

## Tech

- Tauri v2 + Rust (OS WebView, ~10MB binary) — `uz.bestway.exam`
- Vite 8 + React 19 + TS + Tailwind v4 + TanStack Query + zod
- Rust crates: `single-instance`, `opener`, `deep-link`, `clipboard-manager`, `updater`, `process`, `starship-battery`, `serde`, `reqwest` (auth refresh), `keyring` (token store)

## Structure

```
src/
  App.tsx                 # login/exams/runner/locked/result + StatusBar
  pages/                  # Login, Exams, Runner, Locked, Result
  components/StatusBar.tsx + BatteryIndicator.tsx + ClickSpark.tsx + CursorTrail.tsx
  hooks/useBattery.ts     # Tauri → browser → unknown fallback, 30s poll
  hooks/useLockdown.ts    # fullscreen, shortcut/clipboard block, cheat callback
  lib/api.ts              # direct /v1 client (no Next proxy)
  lib/oauth.ts            # browser login: authorize URL, deep-link, code exchange
  lib/exam-sessions.ts    # lock/unlock/roster contract
  lib/heartbeat.ts        # 15s POST /exam-desktop/heartbeat
  lib/cheat.ts            # POST .../flag-cheat (tests|mock)
  lib/session.ts          # student gate, deviceId
src-tauri/
  src/main.rs             # get_battery, set_locked, clear_clipboard, block close
  src/battery.rs          # starship-battery, never panics
  src/lockdown.rs         # set_kiosk + per-OS stubs
  tauri.conf.json         # fullscreen, no decorations, alwaysOnTop, nsis+dmg+appimage/deb
  capabilities/default.json
```

## Quick start

```bash
npm install
# web-only preview (battery uses browser API fallback):
npm run dev
# full desktop shell:
npm run tauri dev
```

Env (`.env` in the repo root, never commit):

```bash
VITE_API_URL=http://localhost:3001/v1
VITE_WEB_URL=http://localhost:3005
```

| Var | Default | Purpose |
| --- | ------- | ------- |
| `VITE_API_URL` | `http://localhost:3001/v1` | Backend base URL (`/v1` included) |
| `VITE_WEB_URL` | `http://localhost:3005` | System-browser login page origin (`/oauth/desktop`) |

## Browser login

`Login → Continue in web browser` opens the OS browser to
`{WEB_URL}/oauth/desktop?device=…&state=…&redirect=bestway-exam://auth/callback`.
After web login the backend redirects to `bestway-exam://…` (deep-link plugin
catches it) or shows a code the student pastes back. Code is exchanged at
`POST /auth/desktop/exchange`. Until the backend ships `GET /oauth/desktop` +
`POST /auth/desktop/exchange`, password sign-in works.
See the contract: `https://github.com/bestwayec/bestway/blob/main/backend/api-contract.md`.

## Backend contract (external, monorepo first)

The backend lives in `https://github.com/bestwayec/bestway` — this client implements its side of that contract:

- `GET /exam-sessions/active?groupId=` → active locked session (404 = none)
- `GET /exam-sessions/:id/roster` → `{userId,name,online,locked,cheatCount,heartbeatAt}`
- `POST /exam-sessions/:id/lock-all|unlock-all|force-submit`
- `POST /exam-desktop/heartbeat {attemptId, locked}` every 15s
- `POST /tests/attempts/:id/flag-cheat` / `POST /mock/attempts/:id/flag-cheat` (`tab_switch|blur|paste|shortcut`)
- Existing `POST /tests/:id/start|.../answer|.../submit`, `POST /mock/exams/:id/start|...` reused as-is

## Lockdown limits (honest)

App layer **cannot** block `Ctrl+Alt+Del`, power button, USB boot, Task Manager kill by admin-rights user, or all macOS/Wayland gestures. Mitigation: non-admin student accounts + physical proctor + heartbeat-loss red flag in roster. True kiosk = Windows Assigned Access / MDM (Phase 2).

## Release (`bestway-app vX.Y.Z`)

Versions live in five files (keep all in sync — see `CONTRIBUTING.md`): `package.json`, `package-lock.json`, `src-tauri/tauri.conf.json`, `src-tauri/Cargo.toml`, `src-tauri/Cargo.lock`.
Tag and push — CI builds Windows/macOS/Linux installers and names the GitHub Release `bestway-app vX.Y.Z`:

```bash
git tag bestway-app-v0.3.0
git push origin bestway-app-v0.3.0
```

Releases: `https://github.com/bestwayec/bw-tauri/releases`. The in-app updater polls `https://github.com/bestwayec/bw-tauri/releases/latest/download/latest.json`.

## Troubleshooting

- `link.exe not found` on `cargo check` → install MSVC Build Tools (Desktop C++ workload)
- Battery shows `—%` → no OS battery (desktop PC) or Tauri IPC not running in `vite dev` — expected fallback
- Blank screen in `tauri dev` → check `VITE_API_URL` reachable + `devUrl http://localhost:1420`
