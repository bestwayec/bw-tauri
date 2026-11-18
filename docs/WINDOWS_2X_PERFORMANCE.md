# BESTWAY WINDOWS 2.0 — REAL PERFORMANCE & BENCHMARK REPORT

**Target Platform:** Windows 10 Pro (x64, Build 10.0.19044), WebView2 Evergreen, 4 GB RAM Lab PCs  
**Date:** 2026-11-18  
**Author:** Komiljon Roziyev (`kruziyev0@gmail.com`)  
**Hardware Profile (Actual Measured Reference Machine):**
- **Processor:** Intel(R) Core(TM) i3-10110U CPU @ 2.10GHz (2 Cores, 4 Logical Processors)
- **Physical Memory:** 4,024,628 KB total (~3,930 MB, 4 GB RAM), ~890 MB available
- **Display / GPU:** Intel(R) UHD Graphics (1 GB VRAM, Driver: 27.20.100.9664)
- **WebView2 Runtime:** Microsoft Edge WebView2 Evergreen 157.0.4341.60

---

## 1. Real Packaged Windows Desktop Application Benchmarks (`tools/measure-windows-app.ps1`)

Measured on the actual compiled Windows desktop executable (`src-tauri/target/debug/bestway-app.exe`) and its spawned child WebView2 runtime processes (`msedgewebview2.exe`).

### A. Launch Duration (3 Samples)
- **Sample 1 (Cold Launch to Window):** `1,022 ms`
- **Sample 2 (Warm Launch to Window):** `176 ms`
- **Sample 3 (Warm Launch to Window):** `355 ms`
- **Median Launch:** `355 ms` | **p95 Launch:** `1,022 ms`

### B. Real Working-Set Process Memory (Combined Desktop Footprint)
- **Rust Host Process (`bestway-app.exe`):**
  - Sample 1: `23.09 MB`
  - Sample 2: `33.07 MB`
  - Sample 3: `28.92 MB`
  - **Median Host Working Set:** `28.92 MB`
- **WebView2 Child Processes (`msedgewebview2.exe` Renderer, GPU, Audio, Utility):**
  - Sample 1: `109.89 MB`
  - Sample 2: `111.44 MB`
  - Sample 3: `110.74 MB`
  - **Median WebView2 Working Set:** `110.74 MB`
- **Combined Total Application Working Set Memory:**
  - Sample 1: `132.98 MB`
  - Sample 2: `144.51 MB`
  - Sample 3: `139.66 MB`
  - **Median Working Set Memory:** `139.66 MB`
  - **p95 Working Set Memory:** `144.51 MB`

---

## 2. Storage & Production Bundle Footprints (`tools/measure-windows-perf.mjs`)

### A. Real IndexedDB Sequential Write Latency (100 Transactions)
- **p50 Latency:** `0.104 ms`
- **p95 Latency:** `0.461 ms`
- **p99 Latency:** `6.070 ms`

### B. Production JavaScript Asset Sizes (`dist/assets/`)
| Asset / Chunk Name | Minified Size | Gzip Size | Architectural Role | Optimization Applied |
| :--- | :---: | :---: | :--- | :--- |
| `BootSplash-*.js` | **1.62 kB** | **0.75 kB** | Initial startup shell | Dynamic Three.js decoupling |
| `vendor-three-*.js` | **923.95 kB** | **249.62 kB** | 3D visual effects bundle | Isolated in dedicated chunk; **0 KB loaded** on 4GB systems or reduced-motion |
| `BestWayLogo3D-*.js` | **112.50 kB** | **44.16 kB** | 3D canvas logo component | Lazy loaded on demand via React `Suspense` |
| `ExamRunner-*.js` | **119.56 kB** | **36.59 kB** | Core CBT exam runner engine | Modular layout with optimized 980px split view |
| `index-*.js` | **326.23 kB** | **99.70 kB** | Application entry point | Core runtime, router, and query client |
| `index-*.css` | **137.62 kB** | **22.15 kB** | Global styling | Tailwind CSS v4 tree-shaken styles |

### C. ESM Chunk Evaluation Speeds
- **Cold Chunk Import (`exam-types`):** `17.214 ms`
- **Warm Chunk Import (`exam-types`):** `0.125 ms`

---

## 3. Methodology Corrections & Disclaimers

1. **Keystroke Input Latency Distinction**:
   - `Map.set()` is an in-memory hash map lookup and must never be labeled as real UI keystroke latency. Real keystroke latency involves Win32 message dispatch, WebView2 IPC, DOM synthetic event handling, React state updates, and browser paint cycles.
   - **Status:** **UNVERIFIED (Requires Physical Hardware Input Testing)**.
2. **Process Memory Footprint Distinction**:
   - Node.js internal process memory (`process.memoryUsage()`, ~32 MB) reflects only the CLI benchmark script's own V8 heap.
   - The actual packaged Tauri + WebView2 desktop application memory footprint is **~139.7 MB** (combined host + browser + renderer + GPU processes).
3. **Full 60-Minute Exam Session Memory**:
   - Long-term memory stability under active exam proctoring with periodic webcam snapshots and audio streaming.
   - **Status:** **UNVERIFIED (Requires Physical Lab Session)**.

---

## 4. 4 GB Low-End System Optimizations

1. **Automatic Three.js Bypass (`src/lib/device-capability.ts`)**:
   - Automatically activates fallback if `navigator.deviceMemory <= 4`, or if `navigator.deviceMemory` is unavailable (`undefined`), or if `prefers-reduced-motion` is active.
   - **0 KB** of Three.js is downloaded or executed on 4GB lab PCs, saving ~1 MB of bundle parse time and preventing WebGL context crashes.
2. **Idle Login Screen Optimization (`src/components/LoginBackdrop.tsx`)**:
   - Particle background animation is completely skipped on low-end systems (`isLowEndSystem()`), reducing idle CPU usage to 0% while preserving the clean dark gradient design.
