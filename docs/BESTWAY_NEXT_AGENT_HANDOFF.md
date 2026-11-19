# BESTWAY NEXT — Engineering Agent Handoff Guide

## 1. Context & Architecture Overview

This project is the development of **BESTWAY NEXT** (Stages 00–03), modernizing the classroom management, vocabulary studio, homework, and multi-role workflows across two synchronized repositories:
1. `bestwayec/bestway`: Django REST backend + Next.js web application.
   - Branch: `feat/bestway-next-00-03`
   - Active Draft PR: [#206](https://github.com/bestwayec/bestway/pull/206)
2. `bestwayec/bw-tauri`: Tauri-based cross-platform client (Desktop + Mobile).
   - Branch: `feat/bestway-next-00-03`
   - Active Draft PR: [#38](https://github.com/bestwayec/bw-tauri/pull/38)

---

## 2. Invariants & Development Directives

1. **Human Authorship Mandate**:
   - Commits must strictly be authored under:
     ```bash
     git config user.name "Komiljon Roziyev"
     git config user.email "kruziyev0@gmail.com"
     ```
   - Absolute ban on AI signatures, bot tags (`Co-authored-by: agent`, `Signed-off-by: bot`), or automated tool footers in commit messages and documentation.
2. **Branch & PR Hygiene**:
   - Work strictly on existing branch `feat/bestway-next-00-03`.
   - Keep both PRs (#206, #38) in **Draft** state.
   - Never force-push (`git push --force`) or reset remote history.
   - Do NOT touch `Grandec` or `bestwayec/lms`.
3. **Offline Learning Boundaries**:
   - Offline flashcard and vocabulary study is supported with client persistence.
   - Official homework scores and SRS reviews are strictly **server-authoritative**.
   - Active exam answer recovery remains strictly independent from vocabulary caching.
   - Client storage must be strictly isolated by authenticated account ID to prevent cross-user leakage.

---

## 3. Current Verified State

### 3.1 Backend & Web (`bestwayec/bestway`)
- Remote HEAD: `b335a4cbcfc23c7aa3ae5198ec5be1fe41bc90d1`
- Implemented Endpoints:
  - `GET /v1/student/assignments/<id>/vocabulary/snapshot`: Enforces enrollment, returns complete authorized collection and revision.
  - `POST /v1/student/assignments/<id>/vocabulary/flashcards/sync`: Idempotent batch mutation sync with `opId` acknowledgements.
  - `PATCH /v1/student/assignments/<id>/vocabulary/flashcards`: Backward-compatible single or batch familiarity update.
- Tests & Validation:
  - Unit tests: `python manage.py test tests.test_vocabulary_offline_sync` (PASS).
  - PostgreSQL integration tests: `python scripts/verify_vocabulary_homework_postgres.py` (PASS).
  - Hosted CI run `44557947516` (both `frontend` and `django` jobs: **100% PASS**).

### 3.2 Desktop & Mobile (`bestwayec/bw-tauri`)
- Remote HEAD: `d182eee1b93f2f012e84fa180769d4d97e3a9dc9`
- Implemented Features:
  - Account-isolated IndexedDB snapshot caching and mutation queue (`src/lib/offline-vocabulary.ts`).
  - Study position restoration across app restarts.
  - Reconnection reconciliation with batch sync.
  - Full keyboard accessibility and offline UI status badges (`src/pages/Vocabulary.tsx`).
- CI & Emulator Fix:
  - Configured `ANDROID_AVD_HOME`, `ANDROID_USER_HOME`, license agreements, and runtime permission pre-granting (`-g`).
  - Hosted CI run `44555969440` (`ci`, `rust`, and `android` emulator boot: **100% PASS**).

---

## 4. How to Run Local Verification

### 4.1 In `bestwayec/bestway`
```bash
cd backend-django
# Run offline sync unit tests
python manage.py test tests.test_vocabulary_offline_sync

# Run PostgreSQL full verification (requires local postgres test database)
python scripts/verify_vocabulary_homework_postgres.py

# Frontend regressions
cd ../frontend
npm run lint
npm test
npm run build
```

### 4.2 In `bestwayec/bw-tauri`
```bash
# Type check and unit tests
npx tsc --noEmit
npm test

# Build client
npm run build

# Run offline vocabulary unit test suite directly
npx vitest run src/lib/offline-vocabulary.test.ts
```

---

## 5. Next Planned Work (Stage 04 & Native Acceptance)

When moving beyond Stage 03:
1. **Physical Device Acceptance**:
   - Test packaged Android APK on physical ARM64 / ARMv7 devices.
   - Verify hardware audio playback and microphone permissions during speech synthesis / pronunciation practice.
2. **Release Keystore Signing**:
   - Ensure production Android builds satisfy `production-binary-guard` (size >= 3 MB, v1+v2+v3 signature schemes, `minSdkVersion >= 24`).
3. **Stage 04 Planning**:
   - Expand teacher analytics and live classroom synchronization using the established API contracts.
