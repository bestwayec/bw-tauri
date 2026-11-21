# BESTWAY NEXT — Stage 06 desktop release handoff

Companion of [bestway#207](https://github.com/bestwayec/bestway/pull/207). Owner checklist:
`docs/BESTWAY_NEXT_OWNER_MERGE_CHECKLIST.md` in the bestway repository.

## What changed in this round (PR #39)

| Commit | Change |
| --- | --- |
| `8cf17a8` | Session: credential read-back before deleting the file fallback; serialized, uniquely named keyring tests. Assignments widget: null-score, empty-state, keyboard tabs, account-scoped vocabulary deep link; jsdom interaction tests (adds `jsdom@25.0.1` dev dependency, matching the website) |
| `83fd6ac` | Vocabulary Studio: CSV/TSV/TXT import through the server parser, duplicate detection matching the server rule, duplicates block preview/save |

No Tauri configuration, capability, updater, signing or Android manifest change. No new runtime
dependency.

## API compatibility

No endpoint or payload change. The desktop uses existing endpoints
(`/v1/vocabulary/sets/parse-text`, `/v1/vocabulary/sets`, `/v1/student/my-assignments`,
`/v1/groups/:id/assignments/:id/vocabulary-results`). Older desktop builds work with the updated
backend; this build works with the current production backend.

## Release gates still open

1. Physical Windows 10 / 4 GB acceptance (see `BESTWAY_NEXT_STAGE06_NATIVE_ACCEPTANCE.md`).
2. Signed NSIS + updater signature produced by the official release workflow with owner keys; the PR
   validation installer is unsigned and must not be published as an official download.
3. Android release signed with the existing official certificate; verify signer continuity.
4. Linux packaged login/restore re-run on the final HEAD.

## Upgrade and rollback

- Existing users: on first launch the new build reads the existing keyring entry as before. Writes now
  verify read-back; if the platform store does not return the secret, the session is kept in the
  restricted file fallback.
- Rollback: stop promoting the version on the update channel; previous builds read the same keyring
  entry. Offline vocabulary storage format is unchanged.

## Measurements (this session)

- Vite production bundle: `main` 211.6 KB (66.1 KB gzip), `vendor-react` 190.0 KB (58.4 KB gzip),
  `vendor-three` 902.3 KB (240.7 KB gzip; lazily loaded and skipped on ≤4 GB devices).
- Startup and working set: only the hosted Windows runner measurement in the validation workflow;
  no 4 GB hardware measurement.
