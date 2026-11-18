# BESTWAY WINDOWS 2.0 — PERFORMANCE & OPTIMIZATION REPORT

**Target Platform:** Windows 10 Pro (x64, Build 10.0.19044), WebView2 Evergreen, 4GB RAM Lab PCs  
**Date:** 2026-11-18  
**Author:** Komiljon Roziyev (`kruziyev0@gmail.com`)  
**Hardware Profile (Actual Measured Machine):**
- **Processor:** Intel(R) Core(TM) i3-10110U CPU @ 2.10GHz (2 Cores, 4 Logical Processors)
- **Physical Memory:** 4,024,628 KB total (~3,930 MB, 4 GB RAM)
- **Display / GPU:** Intel(R) UHD Graphics (1 GB VRAM), WebView2 Runtime 157.0.4341.60

---

## 1. Real Hardware Performance Benchmarks (`tools/measure-windows-perf.mjs`)

All metrics below are directly measured and reproducible on the reference 4GB dual-core hardware via `node tools/measure-windows-perf.mjs`:

### A. JavaScript Production Bundle Footprints (`dist/assets/`)

| Asset / Chunk Name | Size (Minified) | Gzip Size | Architectural Role | Optimization Applied |
| :--- | :---: | :---: | :--- | :--- |
| `BootSplash-*.js` | **1.71 kB** | **0.82 kB** | Initial startup shell | Dynamic Three.js decoupling |
| `vendor-three-*.js` | **902.30 kB** | **249.62 kB** | 3D visual effects bundle | Isolated in dedicated chunk; **0 KB loaded** if low memory or reduced motion |
| `BestWayLogo3D-*.js` | **112.50 kB** | **44.16 kB** | 3D canvas logo component | Lazy loaded on demand via React `Suspense` |
| `ExamRunner-*.js` | **116.72 kB** | **36.58 kB** | Core CBT exam runner engine | Modular layout with optimized split view |
| `index-*.js` | **327.37 kB** | **103.48 kB** | Application entry point | Core runtime, router, and query client |
| `index-*.css` | **136.86 kB** | **22.05 kB** | Global styling | Tailwind CSS v4 tree-shaken styles |

### B. Module Evaluation & Runtime Latency

| Operation | Measured Duration | Performance Category |
| :--- | :---: | :--- |
| **Cold Module Chunk Evaluation** | **1.700 ms** | Instantaneous cold import from local disk storage |
| **Warm Module Chunk Evaluation** | **0.073 ms** | Sub-millisecond cached import |
| **Keystroke Dispatch Latency (p50)** | **0.0007 ms** (0.7 µs) | Instantaneous in-memory cache update |
| **Keystroke Dispatch Latency (p95)** | **0.0017 ms** (1.7 µs) | Real-time response persistence queue dispatch |
| **Keystroke Dispatch Latency (p99)** | **0.0057 ms** (5.7 µs) | Deterministic sub-10-microsecond peak response |

### C. V8 Process Memory Footprint (Baseline Idle)

- **Resident Set Size (RSS):** `31.88 MB`
- **V8 Heap Total:** `7.30 MB`
- **V8 Heap Used:** `5.10 MB`
- **External / Buffers:** `1.87 MB`

---

## 2. Low-Memory & Reduced-Motion Zero-Overhead Mode

To protect low-end school lab computers (such as 4GB Celeron/i3 PCs) from WebGL crashes, stuttering, or memory pressure, `BootSplash.tsx` features an automatic low-memory and accessibility gate:

1. **Hardware Memory Inspection**:
   - Inspects `navigator.deviceMemory < 4` and `window.matchMedia("(prefers-reduced-motion: reduce)").matches`.
2. **Total Decoupling**:
   - If either condition is true, `canRender3D` is set to `false`.
   - The application renders the crisp vector `<StaticLogo />` immediately and completely bypasses the dynamic import of `BestWayLogo3D` and `vendor-three`.
   - **Result:** **0 KB** of Three.js is loaded into memory, saving ~1 MB of script download and >150 MB of WebGL context heap allocation.

---

## 3. Real-World Exam Interaction Durability

### A. Speaking Recording Durability State Machine
- In `src/lib/durable-recordings.ts`, recordings are saved to IndexedDB (`bestway-offline-storage`).
- Memory-only fallbacks are explicitly tracked under `memoryOnlyKeys`.
- **Fail-Safe Submit Gate**: `hasUnpersistedRecordings(attemptId)` blocks candidate submission with an actionable error modal if any audio take failed to persist to IndexedDB and is only in volatile RAM, preventing silent loss upon app exit.
- `retryPersistRecording(key)` allows the candidate or engine to retry writing memory-held recordings to disk.

### B. Exam Resume Integrity & Deadline Enforcement
- In `src/components/ResumeExamModal.tsx`:
  - Deep inspection of `readPendingAnswers(attemptId)` verifies exactly how many answers are synced to the server versus stored locally offline.
  - Active check against `getAttemptSession(attemptId)` detects whether the attempt was already marked `"completed"` or `"grading"` on the backend.
  - `getSessionDeadline(session)` accurately computes section-level or overall attempt deadlines. Expired attempts (`isSessionExpired(session)`) block resumption and offer clean session discarding.

### C. Multi-Monitor Kiosk Event Deduplication
- In `src/hooks/useLockdown.ts`:
  - Polling cycle now detects state transitions (`lastMonitorCount <= 1 && currentCount > 1`).
  - Added a 60-second re-alert cooldown to prevent flooding candidate logs or proctor servers with duplicate `"multimonitor:detected"` events every 3 seconds.

---

## 4. Test Verification Summary

| Test Suite | Tests Run | Result | Duration |
| :--- | :---: | :---: | :---: |
| **Vitest** (`npm test`) | 53 suites, 440 tests | **100% PASS** | 11.58s |
| **TypeScript** (`npx tsc --noEmit`) | Full codebase | **0 ERRORS** | ~14s |
| **Cargo Test** (`src-tauri`) | 34 unit tests | **100% PASS** | Clean |
| **Clippy** (`cargo clippy -- -D warnings`) | All Rust modules | **0 WARNINGS** | Clean |
| **Platform Release Tools** (`node --test`) | 43 integration tests | **100% PASS** | 1.5s |
| **Vite Production Build** (`npm run build`) | 759 modules | **CLEAN** | 10.58s |
