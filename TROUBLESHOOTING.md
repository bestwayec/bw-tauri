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

## Exam UI (Job 2) — IELTS-style runner

- One unified runner: `src/components/exam-ui/` (`ExamRunner`, `TopBar`,
  `BottomNav`, `PassagePane`, `QuestionGroup`, `widgets/*`,
  `ListeningEngine`). Both mock sections and legacy tests adapt into the same
  `UIPart[]` model (`model.ts`); the old `Runner`/`MockRunner` and their
  single-use panes are deleted.
- Light paper theme by default, dark toggle in the top bar. No particles or
  glow inside the exam.
- Reading: passage (letters A/B/C, highlight/clear/note tools, localStorage +
  server marks sync for legacy tests) left, questions right, draggable
  divider. Gapped groups (`contentHtml` + `data-gap` tokens) render inline
  numbered inputs; groups without it fall back to per-question cards.
- Listening: strict timed mode plays once + 2:00 review countdown;
  practice mode replays. Audio/images load via authenticated Blob URLs.
- Bottom bar: part tabs with answered/total, every question as a stateful
  jump button (answered/unanswered/flagged/current), flag toggle, Prev/Next,
  section Submit on the last part.
- Autosave: debounced per-answer + bulk flush, offline queue retried on
  reconnect, Saved/Saving…/Offline indicator. Deadlines use the server clock
  (`serverTime` offset); auto-submit on expiry; section submit via `skills`.
- Unit tests: `npm test` (vitest) — widget mapping for all 15 mock types,
  gap parsing, navigation state, timer/deadline math.

### Screen descriptions (no GUI capture in CI; verified in dev)

1. **Listening part** — top bar (name, Reading/listening title, countdown,
   volume, text size, theme, Saved), single column: once-only player with
   Play/volume + "once only" notice, then one radio card per question.
2. **Reading split-pane + table completion** — left: lettered passage with
   yellow highlights + notes toggle; right: "Questions 1–7" + instructions,
   bordered table with numbered gap badges and inline inputs.
3. **Writing Task 2** — single column essay editor with live word count and
   "250+ needed" hint.
4. **Bottom navigation** — part tabs (`Passage 1  13/13`), 40 numbered jump
   buttons colored by state, Flag/Prev/Next-or-Submit.

### 15-type verification checklist (local backend, 2026-10-01)

Real data — `IELTS Academic Reading Practice Test 1` (39 Q, seed student):
`summary_completion`×10, `note_completion`×5, `multi_select`×1,
`true_false_notgiven`×10, `map_labelling`×3, `matching`×4,
`yes_no_notgiven`×3, `table_completion`×3 (5/10 groups gapped `contentHtml`).
Mocked only (vitest, no local exam covers them yet): `multiple_choice`,
`matching_headings`, `sentence_completion`, `short_answer`, `essay_task1`,
`essay_task2`, `speaking_task` (speaking upload flow preserved from the old
runner; verify against a real speaking mock before release).

### Decisions worth knowing

- Multi-select count is shown live ("N selected") but not hard-capped: the
  backend scores the exact set and the required count lives in free text.
- Legacy tests have no server clock in `start` — deadlines use the client
  clock there (offset 0); mocks use `serverTime`.
- Flags are per-session (in-memory); answers persist server-side.
- `contentLayout` is accepted and validated but not yet used for layout
  variants — groups render notes/table/summary identically.

## Frozen contract (never change)

- Deep-link scheme `bestway-exam://`, Tauri identifier `uz.bestway.exam`.
- Five-file version sync: `package.json`, `package-lock.json`,
  `src-tauri/tauri.conf.json`, `src-tauri/Cargo.toml`, `src-tauri/Cargo.lock`.
