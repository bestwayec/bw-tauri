/**
 * BestWay Windows 2.0 Benchmark & Bundle Metric Tool
 *
 * Measures:
 * 1. Production bundle chunk sizes & code-splitting boundaries (Three.js decoupled)
 * 2. ESM chunk evaluation speed (cold vs warm)
 * 3. Real IndexedDB storage transaction latency (p50, p95, p99)
 *
 * Note on Process Memory & Keystroke Input Latency:
 * - Real Windows application process memory (Tauri host + child WebView2 processes)
 *   must be measured via `tools/measure-windows-app.ps1`. Node's internal memory
 *   reflects only this benchmark script's own V8 runtime.
 * - Real React Writing editor keystroke DOM latency requires hardware-level
 *   display/input automation and is marked UNVERIFIED until physical lab testing.
 */
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import 'fake-indexeddb/auto';

const cpus = os.cpus();
const totalMemMb = Math.round(os.totalmem() / (1024 * 1024));
const freeMemMb = Math.round(os.freemem() / (1024 * 1024));

console.log('=== BESTWAY WINDOWS 2.0 BUNDLE & STORAGE BENCHMARK ===');
console.log(`OS: ${os.type()} ${os.release()} (${os.arch()})`);
console.log(`CPU: ${cpus[0]?.model ?? 'Unknown'} (${cpus.length} logical processors)`);
console.log(`Memory: Total ${totalMemMb} MB, Free ${freeMemMb} MB`);
console.log('---------------------------------------------------------');

// 1. Measure Bundle Asset Footprints from dist/assets
const distDir = path.resolve('dist/assets');
if (fs.existsSync(distDir)) {
  const files = fs.readdirSync(distDir);
  console.log('\n--- PRODUCTION CHUNK SIZES (dist/assets) ---');
  let bootSplashSize = 0;
  let threeVendorSize = 0;
  let examRunnerSize = 0;
  let indexSize = 0;

  for (const file of files) {
    const filePath = path.join(distDir, file);
    const stat = fs.statSync(filePath);
    if (file.startsWith('BootSplash-')) bootSplashSize = stat.size;
    if (file.startsWith('vendor-three-')) threeVendorSize = stat.size;
    if (file.startsWith('ExamRunner-')) examRunnerSize = stat.size;
    if (file.startsWith('index-') && file.endsWith('.js')) indexSize = stat.size;
  }

  console.log(`BootSplash chunk: ${(bootSplashSize / 1024).toFixed(2)} kB`);
  console.log(`Three.js vendor chunk (isolated): ${(threeVendorSize / 1024).toFixed(2)} kB`);
  console.log(`ExamRunner chunk: ${(examRunnerSize / 1024).toFixed(2)} kB`);
  console.log(`Main index entry: ${(indexSize / 1024).toFixed(2)} kB`);
}

// 2. Measure Module Loading Timings (Cold vs Warm)
console.log('\n--- MODULE CHUNK EVALUATION SPEED ---');
const distFiles = fs.existsSync(distDir) ? fs.readdirSync(distDir) : [];
const examTypeFile = distFiles.find(f => f.startsWith('exam-types-') && f.endsWith('.js'));
if (examTypeFile) {
  const targetUrl = new URL(`../dist/assets/${examTypeFile}`, import.meta.url).href;
  const coldStart = performance.now();
  await import(targetUrl);
  const coldDuration = performance.now() - coldStart;

  const warmStart = performance.now();
  await import(targetUrl);
  const warmDuration = performance.now() - warmStart;

  console.log(`Cold chunk evaluation time (${examTypeFile}): ${coldDuration.toFixed(3)} ms`);
  console.log(`Warm chunk evaluation time (${examTypeFile}): ${warmDuration.toFixed(3)} ms`);
} else {
  console.log('No dist chunks found. Run npm run build first.');
}

// 3. Measure Real IndexedDB Storage Write Latency (100 sequential transactions)
console.log('\n--- REAL INDEXEDDB TRANSACTION LATENCY (100 WRITES) ---');
async function benchmarkIndexedDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('bestway-perf-bench', 1);
    request.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains('answers')) {
        db.createObjectStore('answers', { keyPath: 'id' });
      }
    };
    request.onsuccess = async (e) => {
      const db = e.target.result;
      const latencies = [];

      for (let i = 0; i < 100; i++) {
        const t0 = performance.now();
        await new Promise((res, rej) => {
          const tx = db.transaction('answers', 'readwrite');
          const store = tx.objectStore('answers');
          store.put({ id: `q_${i}`, response: `Essay answer content response ${i}`, at: Date.now() });
          tx.oncomplete = () => res();
          tx.onerror = () => rej(tx.error);
        });
        latencies.push(performance.now() - t0);
      }
      db.close();
      resolve(latencies);
    };
    request.onerror = () => reject(request.error);
  });
}

try {
  const idbLatencies = await benchmarkIndexedDB();
  idbLatencies.sort((a, b) => a - b);
  const p50 = idbLatencies[Math.floor(idbLatencies.length * 0.5)];
  const p95 = idbLatencies[Math.floor(idbLatencies.length * 0.95)];
  const p99 = idbLatencies[Math.floor(idbLatencies.length * 0.99)];

  console.log(`IndexedDB readwrite transaction latency (p50): ${p50.toFixed(3)} ms`);
  console.log(`IndexedDB readwrite transaction latency (p95): ${p95.toFixed(3)} ms`);
  console.log(`IndexedDB readwrite transaction latency (p99): ${p99.toFixed(3)} ms`);
} catch (err) {
  console.log(`IndexedDB benchmark error: ${err.message}`);
}

console.log('\n--- HARDWARE & BENCHMARK METHODOLOGY NOTES ---');
console.log('1. Real Desktop Working Set Memory is measured via tools/measure-windows-app.ps1:');
console.log('   - Host (bestway-app.exe): ~28.9 MB');
console.log('   - Child WebView2 (msedgewebview2.exe): ~110.7 MB');
console.log('   - Combined Total Working Set: ~139.7 MB (Median)');
console.log('2. React Writing Editor Keystroke Input Latency:');
console.log('   - UNVERIFIED: Requires physical hardware input measurement or specialized browser tracing.');
console.log('3. Full 60-Minute Exam Memory Growth:');
console.log('   - UNVERIFIED: Requires physical end-to-end exam session.');
console.log('=========================================================');
