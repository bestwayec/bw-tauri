/**
 * One-time WebGL capability probe.
 *
 * The boot splash (@react-three/fiber) and the login particles (ogl) need a
 * WebGL context. On lab PCs with blocked GPU drivers, remote desktops or
 * WebView2 with hardware acceleration off, `getContext` returns null and
 * those libraries threw during mount, which blacked out the whole window.
 * Callers check this first and render a static fallback instead.
 */

let cached: boolean | null = null;

export function hasWebGL(): boolean {
  if (cached !== null) return cached;
  cached = probe();
  return cached;
}

/** Test hook: forget the cached probe result. */
export function resetWebGLProbeForTests(): void {
  cached = null;
}

function probe(): boolean {
  try {
    if (typeof document === "undefined" || typeof document.createElement !== "function") return false;
    const canvas = document.createElement("canvas");
    const gl =
      (canvas.getContext("webgl2") as WebGLRenderingContext | null) ??
      (canvas.getContext("webgl") as WebGLRenderingContext | null) ??
      (canvas.getContext("experimental-webgl") as WebGLRenderingContext | null);
    if (!gl) return false;
    // Release the probe context right away; browsers cap live contexts.
    try {
      gl.getExtension("WEBGL_lose_context")?.loseContext();
    } catch {
      /* ignore */
    }
    return true;
  } catch {
    return false;
  }
}
