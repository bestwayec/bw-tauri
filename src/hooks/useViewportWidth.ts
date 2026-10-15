import { useEffect, useState } from "react";

function currentWidth(): number | null {
  if (typeof window === "undefined") return null;
  return Number.isFinite(window.innerWidth) ? window.innerWidth : null;
}

/**
 * Live window width, or null when it cannot be measured (SSR, bare test env).
 * Used to decide the exam layout: a null width keeps the desktop split so the
 * runner never collapses on a platform that cannot report a viewport.
 */
export function useViewportWidth(): number | null {
  const [width, setWidth] = useState<number | null>(currentWidth);
  useEffect(() => {
    if (typeof window === "undefined") return;
    const onResize = () => setWidth(currentWidth());
    // Re-read once mounted: the first paint may precede a real layout pass.
    onResize();
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);
  return width;
}
