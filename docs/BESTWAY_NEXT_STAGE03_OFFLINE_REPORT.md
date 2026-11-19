# BESTWAY NEXT — Stage 03 Offline Vocabulary & Android CI Completion Report

## 1. Executive Summary

This report documents the recovery, implementation, verification, and hosted CI validation for the interrupted **BESTWAY NEXT** engineering mission across two repositories:
- **Backend & Web (`bestwayec/bestway`)**: [Draft PR #206](https://github.com/bestwayec/bestway/pull/206) on branch `feat/bestway-next-00-03`.
- **Desktop & Mobile (`bestwayec/bw-tauri`)**: [Draft PR #38](https://github.com/bestwayec/bw-tauri/pull/38) on branch `feat/bestway-next-00-03`.

All deliverables specified in the mission have been completed, verified with comprehensive local test suites, committed under human authorship, and validated on GitHub Actions hosted CI. Both draft PRs remain strictly in draft state with 100% green CI runs.

---

## 2. Commit Log & Remote Verification

### 2.1 Backend & Web (`bestwayec/bestway`)
- **Starting Remote Reference SHA**: `6ef739cd7b3a1ae2510c50fe7cdbdb2c4a88068b`
- **Current Remote HEAD**: `b335a4cbcfc23c7aa3ae5198ec5be1fe41bc90d1`
- **Commits Added**:
  1. `f8f8619` — `feat(vocab): implement offline collection snapshots and idempotent flashcard synchronization`
  2. `4ccf9c4` — `test(vocab): verify offline snapshot, batch sync, and multi-device persistence`
  3. `b335a4c` — `test(vocab): order batch sync verification after homework submission`

### 2.2 Desktop & Mobile (`bestwayec/bw-tauri`)
- **Starting Remote Reference SHA**: `67dd1faad014bbb589865e5a096dce3398e3827a`
- **Current Remote HEAD**: `d182eee1b93f2f012e84fa180769d4d97e3a9dc9`
- **Commits Added**:
  1. `bb14e98` — `ci(android): ensure consistent avd environment and verify emulator discovery`
  2. `6c108e1` — `feat(vocab): implement account-isolated offline vocabulary and flashcard persistence`
  3. `d182eee` — `ci(android): grant permissions at install to prevent foreground modal occlusion`

---

## 3. Step 1: Android CI Emulator Boot Resolution

### 3.1 Initial Failure Analysis
- **Failing CI Run**: [44546818230](https://github.com/bestwayec/bw-tauri/actions/runs/44546818230)
- **Root Cause**:
  1. The Android C++ emulator binary looks for AVD definitions in `$ANDROID_AVD_HOME` or `$HOME/.android/avd`. In GitHub Actions ubuntu runner, `ANDROID_AVD_HOME` was unset, and `avdmanager` wrote the ini to a path that `emulator` could not locate, resulting in `ERROR: Unknown AVD name [bestway-pr], HOME is defined but bestway-pr.ini cannot be found.`
  2. On first launch in Android 13+, a system permission dialog (`GrantPermissionsActivity`) popped up over `MainActivity`, preventing clean activity assertion.

### 3.2 Implemented Fix
- Configured explicit environment variables in `.github/workflows/ci.yml`:
  ```bash
  export ANDROID_AVD_HOME="$HOME/.android/avd"
  export ANDROID_USER_HOME="$HOME/.android"
  export ANDROID_SDK_ROOT="$ANDROID_HOME"
  ```
- Added license acceptance and verified AVD creation with `"$sdk_bin/avdmanager" list avd`.
- Verified AVD discovery using `"$emulator" -list-avds`.
- Added runtime permission pre-granting (`-g`) during debug APK installation:
  ```bash
  adb install -g -t android/app/build/outputs/apk/debug/app-debug.apk
  ```
- Pre-granted runtime permissions (`POST_NOTIFICATIONS`, `RECORD_AUDIO`) and verified `uz.bestwayec.app/.MainActivity` in running activities.

### 3.3 Hosted CI Evidence
- **Successful CI Run**: [44555969440](https://github.com/bestwayec/bw-tauri/actions/runs/44555969440)
  - `ci`: **PASSED** (30s)
  - `rust`: **PASSED** (2m0s)
  - `android`: **PASSED** (3m37s) — Emulator booted in 31,492 ms, installed debug APK, launched MainActivity, confirmed running process.

---

## 4. Step 2: Account-Isolated Offline Vocabulary & Flashcards (`bw-tauri`)

### 4.1 Architecture & Design
In accordance with product owner approval:
- **Offline Flashcard & Vocabulary Learning**: Allowed locally without active network connection.
- **Offline Score & Attempt Independence**: Official exam scoring and SRS reviews remain strictly server-authoritative and separate from flashcard study progress.
- **Account Isolation**: To prevent data leakage across account switches or shared devices, storage keys are strictly namespaced by authenticated user ID and assignment ID:
  - IndexedDB Namespace: `vocab.${userId}.${assignmentId}`
  - Flashcard Progress: `vocab.${userId}.${assignmentId}.progress`
  - Mutation Queue: `vocab.${userId}.${assignmentId}.mutations`
  - Study Position: `vocab.${userId}.${assignmentId}.position`

### 4.2 Implementation Details (`src/lib/offline-vocabulary.ts`)
1. **Durable Snapshot Caching**:
   - `saveOfflineSnapshot(userId, snapshot)` persists authorized word cards, collection metadata, and revision.
   - `getOfflineSnapshot(userId, assignmentId)` loads cached collections when offline.
2. **Durable Mutation Queue**:
   - When offline, familiarity changes (Known / Need Practice) are enqueued with stable client-generated UUID `opId`s.
   - Survives application restart and process death.
3. **Study Position Preservation**:
   - Current card index and study order are saved immediately and restored upon view reopen or application restart.
4. **Online Reconciliation**:
   - When online connectivity returns, `syncOfflineMutations(userId, assignmentId, client)` flushes pending mutations in batches to `POST /v1/student/assignments/<id>/vocabulary/flashcards/sync`.
   - Acknowledged `opId`s are removed durably from the queue.
5. **UI & Accessibility Enhancements (`src/pages/Vocabulary.tsx`)**:
   - Visual status pill indicating Online / Offline / Syncing / Pending mutations.
   - "Download for Offline" button for explicit snapshot pre-caching.
   - Full keyboard accessibility: `Space` (flip card), `ArrowLeft` / `ArrowRight` (navigation), `1` or `K` (Known), `2` or `P` (Need Practice).

### 4.3 Client Verification
- Unit test suite: `src/lib/offline-vocabulary.test.ts` (7 tests covering snapshot caching, queueing, account isolation, position resume, and sync acknowledgement — all passed in 36ms).
- Vitest suite: 55 test files, 458 tests passing.
- TypeScript compiler: `npx tsc --noEmit` passed with 0 errors.
- Production build: `npm run build` succeeded.

---

## 5. Step 3: Backward-Compatible Offline Sync API (`bestway`)

### 5.1 Backend Endpoints (`backend-django/apps/core/vocabulary_homework.py`)
1. **Authorized Snapshot Endpoint**:
   - `GET /v1/student/assignments/<id>/vocabulary/snapshot`
   - Returns full word collection, metadata, and collection revision for authorized enrolled students.
   - Enforces group enrollment and assignment access; strangers receive `403 Forbidden`.
2. **Batch Mutation Synchronization**:
   - `POST /v1/student/assignments/<id>/vocabulary/flashcards/sync`
   - Accepts batch mutations:
     ```json
     {
       "lastWordId": "word-uuid",
       "mutations": [
         { "opId": "uuid-1", "wordId": "word-uuid-1", "status": "known" }
       ]
     }
     ```
   - Filters out non-existent or unknown word IDs.
   - Limits batch size to <= 100 mutations to prevent memory exhaustion.
   - Atomically updates familiarity state and returns `acknowledgedOpIds` alongside the updated state.
3. **Backward Compatibility**:
   - Updated `PATCH /v1/student/assignments/<id>/vocabulary/flashcards` to accept both single `wordId` updates and batch `mutations`.

### 5.2 API Contract & Schema Synchronization
- Updated OpenAPI specification: `docs/contracts/groups.v1.openapi.json`.
- Synchronized TypeScript contract DTOs: `frontend/src/lib/group-contract.generated.ts` and `bw-tauri/src/lib/group-contract.generated.ts`.

### 5.3 Backend Verification
- Unit test suite: `backend-django/tests/test_vocabulary_offline_sync.py` (6 tests passing in 0.032s).
- Full PostgreSQL verification: `backend-django/scripts/verify_vocabulary_homework_postgres.py` verified snapshot access, cross-device sync, batch mutation acknowledgement, homework scoring, and teacher export.

---

## 6. Hosted CI Status & Evidence Table

| Repository | Workflow / Gate | Run ID | Status | Duration |
| :--- | :--- | :--- | :--- | :--- |
| **`bw-tauri`** | Code & Lint Check (`ci`) | [44555969440](https://github.com/bestwayec/bw-tauri/actions/runs/44555969440) | **PASS** | 30s |
| **`bw-tauri`** | Rust Backend Tests (`rust`) | [44555969440](https://github.com/bestwayec/bw-tauri/actions/runs/44555969440) | **PASS** | 2m0s |
| **`bw-tauri`** | Android Emulator CI (`android`) | [44555969440](https://github.com/bestwayec/bw-tauri/actions/runs/44555969440) | **PASS** | 3m37s |
| **`bw-tauri`** | Windows Installer Validation | [44554027365](https://github.com/bestwayec/bw-tauri/actions/runs/44554027365) | **PASS** | 4m12s |
| **`bw-tauri`** | Browser Exam Recovery Validation | [44555969384](https://github.com/bestwayec/bw-tauri/actions/runs/44555969384) | **PASS** | 1m45s |
| **`bestway`** | Frontend Lint, Tests, Build (`frontend`) | [44557947516](https://github.com/bestwayec/bestway/actions/runs/44557947516) | **PASS** | 2m31s |
| **`bestway`** | Django, Prisma, PostgreSQL Tests (`django`) | [44557947516](https://github.com/bestwayec/bestway/actions/runs/44557947516) | **PASS** | 3m11s |

---

## 7. Native Acceptance Status Matrix

| Scenario | Status | Verified Scope | Unverified Scope |
| :--- | :--- | :--- | :--- |
| **Linux Desktop (Debian)** | PARTIAL | Packaged HTTPS login, classroom/vocabulary studio navigation, virtual PulseAudio audio. | Real system keyring, native OS update installer, low-memory physical device. |
| **Windows Desktop (x64)** | PARTIAL | Hosted NSIS installer compilation, silent install/launch smoke, app working-set measurement. | Physical Windows touch, manual uninstaller cleanup, authenticated API journeys. |
| **Android Mobile** | PARTIAL | Emulator boot (31.4s), debug APK installation (`-g`), MainActivity launch, running activity verification in CI. | Physical hardware touchscreen, camera/mic permissions, offline SQLite persistence, production release keystore signing. |
| **Offline Vocabulary** | PASS | Account-isolated IndexedDB snapshots, durable mutation queue, position restore across restart, multi-device reconciliation. | Physical disconnection on native mobile hardware during active audio playback. |
| **Exam Recovery** | PASS | Independent Chromium & WebKit storage, timer reconciliation, resumption of active question attempts. | Native mobile battery exhaustion recovery. |

---

## 8. Handoff Checklist & Invariants
- [x] Both PRs ([bestwayec/bestway#206](https://github.com/bestwayec/bestway/pull/206) and [bestwayec/bw-tauri#38](https://github.com/bestwayec/bw-tauri/pull/38)) remain in **Draft** state.
- [x] No modifications to `Grandec` or `bestwayec/lms`.
- [x] All commits authored strictly under `Komiljon Roziyev <kruziyev0@gmail.com>`.
- [x] Zero AI attribution footers or machine co-authorship tags across all commits, logs, and documentation.
- [x] No fake success or bypassed test gates.
