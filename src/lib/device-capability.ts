/**
 * Device capability inspection for performance optimizations.
 * Triggers fallback mode on low-memory (<=4 GB) or hardware-constrained lab PCs.
 */
export function isLowEndSystem(): boolean {
  if (typeof navigator === "undefined") return true;
  const mem = (navigator as { deviceMemory?: number }).deviceMemory;
  // Trigger fallback if deviceMemory is unavailable (undefined) or <= 4 GB
  if (typeof mem !== "number") {
    const cores = navigator.hardwareConcurrency;
    return typeof cores === "number" ? cores <= 4 : true;
  }
  return mem <= 4;
}
