# BESTWAY WINDOWS 2.0 — COMPREHENSIVE ARCHITECTURE & SECURITY AUDIT

**Target:** `bestwayec/bw-tauri`  
**Platform:** Windows Desktop Application (Tauri v2, Rust, Win32, React 19, WebView2)  
**Branch:** `feat/windows-2x-desktop-evolution`  
**Author:** Komiljon Roziyev (`kruziyev0@gmail.com`)  
**Date:** 2026-11-18  

---

## 1. Executive Summary

This audit evaluates the current state of the BESTWAY Windows desktop application following the merge of PR #36. The application is an installable Windows program running on Tauri v2 with a Rust core, Win32 native APIs, and a React 19/TypeScript frontend hosted inside Microsoft Edge WebView2.

The audit identifies verified defects, architecture constraints, performance bottlenecks on 4GB RAM lab PCs, and operational gaps across exam data integrity, session durability, kiosk security, and offline resilience.

---

## 2. Core Architecture Review

```text
┌─────────────────────────────────────────────────────────────────┐
│                      Windows Desktop Host                       │
│                                                                 │
│  ┌──────────────────────┐             ┌──────────────────────┐  │
│  │   Tauri v2 / Rust    │             │  WebView2 Frontend   │  │
│  │   - Win32 Kiosk Hook │  IPC Bridge │  - React 19 / TS     │  │
│  │   - Process Monitor  ├─────────────┤  - Offline Queue     │  │
│  │   - Session Keyring  │             │  - IndexedDB Cache   │  │
│  │   - Stream Decrypt   │             │  - Exam UI & Timers  │  │
│  └──────────┬───────────┘             └──────────┬───────────┘  │
│             │                                    │              │
└─────────────┼────────────────────────────────────┼──────────────┘
              │                                    │
              ▼                                    ▼
       OS Credential Store                  IndexedDB / Mirror
      (Windows Credential)                 (bestway-offline-v1)
```

### Components Audited:
1. **Rust Native Core (`src-tauri/`)**:
   - `lib.rs`: Application initialization, single-instance plugin, deep-link handling, URI scheme `bway://` for offline decrypted video streaming.
   - `lockdown.rs`: Win32 `WH_KEYBOARD_LL` low-level keyboard hook on dedicated background thread with message loop (`GetMessageW`), content protection (`SetWindowDisplayAffinity`).
   - `session.rs`: Single-flight token refresh, OS keyring integration with atomic JSON fallback, credential snapshot isolation.
   - `encryption.rs`: Machine fingerprint derivation, AES-256-GCM chunked file encryption and streaming decryption.
   - `offline_media.rs`: Video filename sanitization, bounded byte-range requests.
2. **Frontend Exam Engine (`src/components/exam-ui/`, `src/lib/`)**:
   - `ExamRunner.tsx`: IELTS & Multi-Level CBT runner, split-view reading, timer synchronization, debounced autosave.
   - `offline-exam.ts`: IndexedDB answer mirroring, pending answer recovery, offline sync state machine.
   - `durable-recordings.ts`: IndexedDB audio take retention for Speaking tests.
   - `session-store.ts`: Zustand session store, proactive JWT refresh (75s lead time), offline revalidation.
   - `useLockdown.ts`: Frontend lockdown guard, shortcut blocking, focus loss reporting.
   - `ResumeExamModal.tsx`: Unfinished session recovery modal.

---

## 3. Verified Findings & Defect Register

### Defect W2X-01: Asynchronous Profile Initialization Breaks Exam Resume
- **Severity**: Critical (P0)
- **Component**: `src/components/ResumeExamModal.tsx`
- **Root Cause**: `ResumeExamModal` called `getActiveMockSession()` only once inside a `useEffect` triggered by `isExamActive`. In `getActiveMockSession()`, the stored session is matched against `useSessionStore.getState().profile?.id`. Because the Tauri session loads asynchronously via Rust IPC on startup, `profile` is `null` when the modal mounts. The check fails, returns `null`, and the modal never prompts the candidate to resume their interrupted exam after app restart or crash.
- **Impact**: Candidates who restart the app after an unexpected shutdown or crash lose the prompt to resume their in-progress exam.
- **Fix**: Subscribe to `useSessionStore((s) => s.profile?.id)` and re-evaluate `getActiveMockSession()` whenever the authenticated profile resolves.

### Defect W2X-02: Practice & Single-Section Tests Lack Session Persistence
- **Severity**: Critical (P1)
- **Component**: `src/App.tsx`, `src/pages/TestRunner.tsx`, `src/components/ResumeExamModal.tsx`
- **Root Cause**: While `handleStartMock` persists the active mock attempt to `localStorage` via `persistActiveMockSession`, `handleStartExam` (used for single-section tests and practice tests) does not record any active session. If the app closes or crashes during a single-section test, no resume modal is displayed.
- **Impact**: Disconnected single-section exams cannot be resumed via the UI.
- **Fix**: Extend session persistence to cover both mock exams and standard tests, enabling unified exam resumption.

### Defect W2X-03: Kiosk Multi-Monitor Plug-In Evasion
- **Severity**: High (P1)
- **Component**: `src-tauri/src/lib.rs`, `src/hooks/useLockdown.ts`
- **Root Cause**: Multi-monitor detection (`check_monitors`) was only executed upon the initial invocation of `set_locked(true)`. If a candidate plugged in a secondary display via HDMI, DisplayPort, or USB-C *after* the exam commenced, the application did not detect or block the display.
- **Impact**: Security vulnerability allowing auxiliary display usage during exams.
- **Fix**: Implement periodic monitor polling in `useLockdown` and emit a monitor violation event when monitor count exceeds 1 while locked.

### Defect W2X-04: Stale Lockdown Dependency Array in `useLockdown.ts`
- **Severity**: High (P1)
- **Component**: `src/hooks/useLockdown.ts`
- **Root Cause**: In `useLockdown.ts`, `effectiveLocked` is computed from `locked` and `isPrivileged = isStaffRole(role)`. However, the main effect's dependency array listed `[locked, requestFullscreen, clearClipboard, lockOrientation, report]`, omitting `effectiveLocked`. If the user profile loaded asynchronously with an admin or teacher role, lockdown remained in an inconsistent state.
- **Impact**: Teacher/proctor accounts could have lockdown inappropriately engaged or failed to release.
- **Fix**: Update dependency array to include `effectiveLocked`.

### Defect W2X-05: Spurious "Still Waiting" Error on Idle Login Screen
- **Severity**: Medium (P2)
- **Component**: `src/pages/Login.tsx`
- **Root Cause**: An unconditional 120-second timer was created on component mount in `Login.tsx`. If a user remained idle on the login screen for 2 minutes without initiating any action, the timer fired and set `error = "Still waiting — if the browser didn't return, cancel and try again."`
- **Impact**: Distracting and confusing false-positive error message for students.
- **Fix**: Condition the timeout nudge strictly on `busy === "browser"` or active `pending` OAuth state.

### Defect W2X-06: Three.js 1.04 MB Bundle Weight Stalling Cold Startup
- **Severity**: High (P2)
- **Component**: `src/components/BootSplash.tsx`, `vite.config.ts`
- **Root Cause**: `BootSplash.tsx` statically imported `BestWayLogo3D.tsx`, causing `@react-three/fiber` and `three.js` (1,037 kB minified, 295 kB gzip) to be bundled into the initial boot asset. On 4GB RAM lab PCs with integrated graphics, parsing this bundle increases cold startup time and memory footprint significantly.
- **Impact**: Slow cold startup on low-spec lab hardware.
- **Fix**: Dynamically lazy-load `BestWayLogo3D` inside `BootSplash` and configure Vite code-splitting to isolate Three.js. If WebGL is unavailable or reduced-motion is requested, Three.js is never loaded.

### Defect W2X-07: Audio Interruption Recovery on Headset Disconnect
- **Severity**: High (P1)
- **Component**: `src/components/exam-ui/ListeningEngine.tsx`, `src/lib/volume.ts`
- **Root Cause**: When an audio output device is disconnected or switched mid-exam (common in lab settings with 3.5mm or USB headsets), HTMLAudioElement fires an error or pauses. The UI had no automatic retry or recovery mechanism.
- **Impact**: Audio stops playing during Listening sections, confusing candidates.
- **Fix**: Add audio error event handler, track playback state, and provide automatic retry and user resume controls.

### Defect W2X-08: Missing Pre-Exam Device Readiness Center
- **Severity**: High (P2)
- **Component**: `src/components/` (New Component Required)
- **Root Cause**: Candidates could start an exam without prior verification of their microphone input level, audio output volume, network latency, and camera permission, leading to mid-exam failures.
- **Impact**: Candidate distress and invalid attempts due to uncalibrated hardware.
- **Fix**: Implement an integrated **Device Readiness Center** verifying audio playback, microphone level detection, camera stream, and backend connectivity.

---

## 4. Performance & Resource Baseline

- **Initial Build Size**:
  - `BootSplash`: 1,037.27 kB (295 kB gzip)
  - `index.js`: 323.98 kB (100 kB gzip)
  - `vendor-react.js`: 194.55 kB (62 kB gzip)
  - `ExamRunner.js`: 125.22 kB (38 kB gzip)
  - Total JS Bundle: ~2.1 MB
- **Test Suite Execution**:
  - Vitest: 52 files, 427 tests (13.80s)
  - Rust Cargo Tests: 34 tests (0.17s runtime)
  - Cargo Clippy: 0 warnings
- **Target Optimization Goals**:
  - Reduce cold startup JS evaluation by code-splitting Three.js.
  - Eliminate all unhandled audio and session recovery race conditions.
  - Guarantee zero silent answer loss under interruption scenarios.
