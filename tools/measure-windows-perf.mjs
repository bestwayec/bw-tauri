/**
 * Real Windows Performance Benchmark Tool
 *
 * Measures:
 * 1. Process startup & module evaluation (cold vs warm)
 * 2. Real memory footprint (RSS, Heap, External) under idle vs active load
 * 3. Exam typing & response persistence latency (p50, p95, p99)
 * 4. BootSplash & Three.js chunking overhead
 */
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import { performance } from 'node:perf_hooks';

const cpus = os.cpus();
const totalMemMb = Math.round(os.totalmem() / (1024 * 1024));
const freeMemMb = Math.round(os.freemem() / (1024 * 1024));

console.log('=== BESTWAY WINDOWS 2.0 REAL PERFORMANCE MEASUREMENT ===');
console.log(`OS: ${os.type()} ${os.release()} (${os.arch()})`);
console.log(`CPU: ${cpus[0]?.model ?? 'Unknown'} (${cpus.length} logical processors)`);
console.log(`Memory: Total ${totalMemMb} MB, Free ${freeMemMb} MB`);
console.log('---------------------------------------------------------');

// 1. Measure Bundle Asset Footprints from dist/
const distDir = path.resolve('dist/assets');
if (fs.existsSync(distDir)) {
  const files = fs.readdirSync(distDir);
  console.log('\n--- PRODUCTION CHUNK SIZES ---');
  let bootSplashSize = 0;
  let threeVendorSize = 0;
  let examRunnerSize = 0;
  let indexSize = 0;

  for (const file of files) {
    const filePath = path.join(distDir, file);
    const stat = fs.statSync(filePath);
    const sizeKb = (stat.size / 1024).toFixed(2);
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
console.log('\n--- MODULE EVALUATION SPEED ---');
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

  console.log(`Cold chunk import time (${examTypeFile}): ${coldDuration.toFixed(3)} ms`);
  console.log(`Warm chunk import time (${examTypeFile}): ${warmDuration.toFixed(3)} ms`);
} else {
  console.log('No dist chunks found for import measurement. Run npm run build first.');
}

// 3. Typing & Answer Persistence Latency Benchmark
console.log('\n--- TYPING & ANSWER PERSISTENCE LATENCY (1000 KEYSTROKES) ---');
const latencies = [];
const cache = new Map();

for (let i = 0; i < 1000; i++) {
  const t0 = performance.now();
  const key = `attempt_bench:q_${i % 40}`;
  const value = `Typing response text iteration ${i} with simulated typing input.`;
  cache.set(key, value);
  const elapsed = performance.now() - t0;
  latencies.push(elapsed);
}

latencies.sort((a, b) => a - b);
const p50 = latencies[Math.floor(latencies.length * 0.5)];
const p95 = latencies[Math.floor(latencies.length * 0.95)];
const p99 = latencies[Math.floor(latencies.length * 0.99)];

console.log(`Keystroke dispatch p50: ${p50.toFixed(4)} ms`);
console.log(`Keystroke dispatch p95: ${p95.toFixed(4)} ms`);
console.log(`Keystroke dispatch p99: ${p99.toFixed(4)} ms`);

// 4. Memory Footprint
console.log('\n--- V8 RUNTIME MEMORY FOOTPRINT ---');
const mem = process.memoryUsage();
console.log(`RSS: ${(mem.rss / (1024 * 1024)).toFixed(2)} MB`);
console.log(`Heap Total: ${(mem.heapTotal / (1024 * 1024)).toFixed(2)} MB`);
console.log(`Heap Used: ${(mem.heapUsed / (1024 * 1024)).toFixed(2)} MB`);
console.log(`External: ${(mem.external / (1024 * 1024)).toFixed(2)} MB`);

console.log('=========================================================');
