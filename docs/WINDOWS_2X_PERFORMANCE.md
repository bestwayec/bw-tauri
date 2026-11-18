# BESTWAY WINDOWS 2.0 — PERFORMANCE & OPTIMIZATION REPORT

**Target Platform:** Windows 10 / 11 (x64), WebView2, 4GB RAM Lab PCs  
**Date:** 2026-11-18  
**Author:** Komiljon Roziyev (`kruziyev0@gmail.com`)  

---

## 1. Baseline Performance Measurements

Measurements captured on initial branch creation (`feat/windows-2x-desktop-evolution` at `19e9ec9`):

### A. JavaScript Bundle Metrics (Production Build)

| Chunk Name | Size (Minified) | Size (Gzip) | Content / Dependencies |
| :--- | :---: | :---: | :--- |
| `BootSplash-*.js` | **1,037.27 kB** | 295.05 kB | `@react-three/fiber`, `three.js`, 3D Logo |
| `index-*.js` | **323.98 kB** | 100.39 kB | Main entry, routing, App core |
| `vendor-react-*.js` | **194.55 kB** | 61.99 kB | React 19, ReactDOM, Scheduler |
| `ExamRunner-*.js` | **125.22 kB** | 38.18 kB | CBT Exam Engine, passage panes, question groups |
| `Particles-*.js` | **51.08 kB** | 15.52 kB | Canvas ambient background |
| `vendor-query-*.js` | **41.14 kB** | 12.48 kB | TanStack Query, Zustand |
| `LiveProctoring-*.js` | **34.80 kB** | 8.83 kB | Teacher proctoring room |
| `Dashboard-*.js` | **29.59 kB** | 8.73 kB | Student dashboard |
| `vendor-tauri-*.js` | **21.93 kB** | 6.00 kB | Tauri v2 API bindings |
| `index-*.css` | **134.29 kB** | 21.79 kB | Tailwind CSS v4 pre-compiled styles |
| **Total Assets** | **~2.1 MB** | **~570 kB** | |

### B. Compilation & Test Execution Speeds
- `npm run build` (`tsc && vite build`): **6.67 seconds**
- `vitest run` (52 files, 427 tests): **13.80 seconds**
- `cargo test` (34 tests): **0.17 seconds** (after compile)
- `cargo clippy`: **0 warnings**

---

## 2. Identified Bottlenecks & Optimization Targets

### Bottleneck 1: Synchronous 3D Logo Loading on Boot
- **Finding**: `BootSplash.tsx` statically imports `BestWayLogo3D.tsx`, forcing a 1.04 MB chunk to load on every startup regardless of whether the PC has WebGL or has reduced motion enabled.
- **Target**: Lazy-load `BestWayLogo3D` dynamically. When WebGL is disabled or reduced motion is true, load the `StaticLogo` fallback immediately (0 KB Three.js overhead).
- **Target Metric**: Reduce initial boot bundle download and parse by ~1 MB on low-end hardware.

### Bottleneck 2: High-DPI & 1366x768 Display Scaling in Split-Pane
- **Finding**: At 125% and 150% Windows display scaling on 1366x768 laptop screens, the split ratio between passage and questions can crush question input fields.
- **Target**: Ensure `SPLIT_MIN` (25%) and `SPLIT_MAX` (75%) responsive boundary clamps dynamically adapt to available viewport width.

### Bottleneck 3: Background Polling Overhead
- **Finding**: Unnecessary query refetching when window is minimized or hidden.
- **Target**: Ensure `refetchIntervalInBackground: false` is honored across all dashboard queries.

---

## 3. Optimization Log (To Be Updated as Fixes Land)

| Step | Area | Optimization Implemented | Before | After | Status |
| :---: | :--- | :--- | :---: | :---: | :---: |
| 1 | Boot Bundle | Lazy-load 3D logo in BootSplash | 1,037 kB | TBD | Pending |
| 2 | Code Splitting | Separate Three.js vendor chunk | Bundled | TBD | Pending |
| 3 | Exam Navigation | Optimize split pane rendering | Reflow | TBD | Pending |
| 4 | Kiosk Memory | Cleanup listeners & audio objects | Baseline | TBD | Pending |
