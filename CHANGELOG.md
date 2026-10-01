# Changelog — Bestway Exam desktop (`bw-tauri`)

## v0.4.0

### Never log the student out (Rust-owned session)
- Token rotation owned by Rust: `auth_refresh` (single-flight mutex +
  expected-token adoption), `session_get/set/clear`, `auth_logout`.
- OS keyring store with atomic file fallback; persist-before-return, so a
  crash mid-refresh cannot lose the rotated pair.
- Single zustand session store (replaces the split `session.ts` + `api.ts`
  state); proactive JWT-`exp` refresh ~75s early; wipe ONLY on
  `INVALID_REFRESH_TOKEN` / `SESSION_EXPIRED` / `USER_DEACTIVATED`.
- Cached-profile boot that never logs out on network failure; persisted
  per-attempt offline answer queue; mid-exam re-login modal over the attempt.

### Reliable fetching
- Exams/Dashboard on TanStack Query (30s staleTime, backoff retries,
  focus/online refetch, no polling while hidden or in-exam).
- Per-source error cards (status/code + API URL + Retry); bilingual access
  copy; release fails fast without `VITE_API_URL`; loopback banner;
  Settings Connection panel with test button.
- CSP `media-src` + `img-src` (`blob:`/`https:`); authenticated Blob media
  with 401→refresh→retry; zod boundary validation (`SCHEMA_MISMATCH`).

### IELTS exam UI
- Unified runner (`src/components/exam-ui/`): light paper theme + dark
  toggle, split-pane reading with highlight/note tools, all 15 types with
  dedicated widgets, inline gapped docs, strict/practice listening,
  question tabs + jump buttons + flags, server-clock deadlines, offline
  autosave with Saved/Saving/Offline indicator.
- Old `Runner`/`MockRunner`/single-use panes deleted; legacy tests run on
  the same runner.

### Hardening & performance
- `[profile.release]` (opt 3, fat LTO, strip); async cached battery;
  keyboard-hook worker thread with release-on-unlock/destroy/exit;
  rotating file logs + panic hook; updater defers during attempts;
  crash-recovery overlay.
- Lazy routes + vendor chunks (initial JS ~417KB, was ~1686KB monolith);
  800ms debounced bulk autosave; dead VolumeControl/ElasticSlider removed.

### Tests
- 57 vitest tests (session single-flight/wipe/adopt/migration, widget
  mapping, gaps, nav, deadlines) + 11 mock-server integration tests +
  schema-conformance tests + Rust unit tests (session store, logger prune).

## v0.3.1
- Prior release state (see git history).
