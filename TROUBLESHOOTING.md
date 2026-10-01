# Troubleshooting — Bestway Exam desktop

## Pointing the app at a backend

| Var | Default | Purpose |
| --- | ------- | ------- |
| `VITE_API_URL` | `http://localhost:3001/v1` | Backend base URL (`/v1` included). Baked in at build time. |
| `VITE_WEB_URL` | `http://localhost:3005` | System-browser login page origin. |

- Local dev: copy `.env.example` to `.env` (never commit `.env`).
- Release builds: set the `VITE_API_URL` repo variable (e.g. `https://api.bestway.uz/v1`).
  The release workflow passes it to the build; if it is missing, a production
  bundle falls back to `localhost` and shows a fail-loud banner instead of an
  empty exam list.
- Check the effective URL any time in **Settings → Connection**, and use the
  **Test connection** button (authenticated `GET /auth/me` with timing).

## Test against a local backend

From the `bestway` monorepo: `docker compose up` (API `:3001`, web `:3005`,
Postgres `:5432`), then `npm run dev` here (uses `http://localhost:3001/v1`).
Seed student: `+998900000010` / `Student123!`. Walk: login → Exams list →
start (practice) → answer → submit section. `Test connection` in Settings
reproduces the auth path in one click.

## Failure modes found (Job 1)

1. **"No exams assigned yet" with exams in backend** — the app talked to the
   wrong backend (release without `VITE_API_URL` → student's own localhost).
   Now: per-source error cards show HTTP status/code + the resolved API URL +
   Retry; empty state renders only on true success-with-zero.
2. **Loopback in production** — red banner on login + warning in Settings when
   a prod build uses a loopback URL.
3. **Remote audio/images blocked** — was missing `media-src` (fell back to
   `default-src 'self'`) and `img-src` had no `https:`. Fixed in
   `tauri.conf.json`. Production backends must be **https** (CSP `connect-src`
   allows `https://*` remotely and `http:` on loopback only) — plain-http LAN
   IPs are blocked by design.
4. **401 on audio/image** — only demo media is public; normal exams need the
   student Bearer token (`<audio>`/`<img>` can't send it). Media is now
   fetched via the API client (401 → refresh → retry) into Blob URLs, with
   loading/error states. Timed listening still plays once (`?attemptId=`).
5. **`access: locked/pending` mocks** — purchasable mocks show "needs a
   purchase / waiting for admin" instead of Start. Draft mocks never list.
6. **0-question rows** — seed leftovers (`prisma/seed.ts`) or unfinished admin
   drafts with `isActive=true`. Students can't start them (`TEST_EMPTY`), so
   the client hides them. Clean them in the backend (deactivate/delete);
   note `seed.ts` re-creates `Multilevel Mock Test #1` on re-seed.
7. **Type drift** — backend adds fields (e.g. `canEdit`, `imported`,
   `contentHtml`). Responses are zod-validated at the boundary; mismatches
   throw `SCHEMA_MISMATCH` with the offending path instead of rendering
   garbage. Unknown keys are stripped, never trusted.
8. **Double submit** — backend rejects with `MOCK_ATTEMPT_FINISHED`; the
   client treats it as already-done, not as a crash.

## Frozen contract (never change)

- Deep-link scheme `bestway-exam://`, Tauri identifier `uz.bestway.exam`.
- Five-file version sync: `package.json`, `package-lock.json`,
  `src-tauri/tauri.conf.json`, `src-tauri/Cargo.toml`, `src-tauri/Cargo.lock`.
