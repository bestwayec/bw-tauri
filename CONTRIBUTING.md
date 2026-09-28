# Contributing to bw-tauri

Thanks for your interest in bw-tauri — Bestway Exam Tauri 2 kiosk desktop client for supervised IELTS/mock exams!

## Code of Conduct

By participating, you agree to follow our [Code of Conduct](CODE_OF_CONDUCT.md).

## How to contribute

1. Fork the repo and create a branch from `main`:
   `git checkout -b feat/short-name` or `fix/short-name`
2. Make focused changes with tests where relevant.
3. Run the same checks as CI before pushing (see below).
4. Open a Pull Request against `main` using the PR template.
5. Link related issues (`Fixes #123`).

## Development setup

Requirements: Node 24.13.0, stable Rust toolchain, MSVC Build Tools (Desktop C++ workload) on Windows, WebKit system deps on Linux (`libwebkit2gtk-4.1-dev`, see `.github/workflows/ci.yml`).

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

The backend API is an external dependency — it runs from the monorepo `https://github.com/bestwayec/bestway` (contract: `https://github.com/bestwayec/bestway/blob/main/backend/api-contract.md`).

## Checks (must pass)

```bash
npm ci
npx tsc --noEmit
npm run build
```

Rust (in `src-tauri/`):

```bash
cargo check
```

## Version sync (five files)

Keep all five in sync on every version bump: `package.json`, `package-lock.json`, `src-tauri/tauri.conf.json`, `src-tauri/Cargo.toml`, `src-tauri/Cargo.lock`.

## Frozen contract

Never change the deep-link scheme (`bestway-exam://`) or the Tauri identifier (`uz.bestway.exam`) — installed clients, the backend OAuth redirect, and the auto-updater all depend on them (see `README.md`).

## Release

Release via tag `bestway-app-vX.Y.Z` — CI builds Windows/macOS/Linux installers and names the GitHub Release `bestway-app vX.Y.Z`:

```bash
git tag bestway-app-v0.3.0
git push origin bestway-app-v0.3.0
```

## Commit style

Use [Conventional Commits](https://www.conventionalcommits.org/):

* `feat: add points leaderboard export`
* `fix(updater): point endpoints at bestwayec/bw-tauri releases`
* `docs: update seed instructions`
* `chore: bump deps`

Keep PRs small and focused. One feature/fix per PR.

## Pull Request rules

* Target `main`.
* Fill in the PR template: summary, what/why, how tested, screenshots for UI.
* Checklist: checks pass, five-file version sync if the version changed, no secrets/`.env` committed.
* CI (`.github/workflows/ci.yml`) must be green.

## Reporting bugs / requesting features

Use the issue templates (Bug report / Feature request). Include:

* app version (`package.json`), steps to reproduce, expected vs actual, Tauri/console logs, screenshots for UI.

## Security

Do NOT open public issues for vulnerabilities. See [SECURITY.md](SECURITY.md) — report via private GitHub Security Advisory (`https://github.com/bestwayec/bw-tauri/security/advisories/new`) or `otashdev1@gmail.com`. Response within 48h.

## License

By contributing, you agree your contributions are licensed under [GPL-3.0-only](LICENSE).
