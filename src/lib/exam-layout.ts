/**
 * Reading / Listening desktop layout for the CBT runner.
 *
 * The runner has three shapes and picks one from the part's content plus the
 * window width:
 *   - `split`   passage on the left, questions on the right, draggable divider
 *               (wide windows — the familiar paper CBT view)
 *   - `stacked` the same passage above the questions in one scroll column
 *               (narrow windows, where two panes would be too cramped to read)
 *   - `single`  questions only (parts with no passage, e.g. Listening)
 *
 * Everything here is pure so the layout rules can be asserted without a DOM.
 */

export type ExamLayout = "split" | "stacked" | "single";

/** Below this window width two reading panes stop being readable side by side. */
export const EXAM_SPLIT_MIN_WIDTH = 1100;

/** Divider bounds and defaults, in percent of the exam width given to the passage. */
export const SPLIT_MIN = 30;
export const SPLIT_MAX = 70;
export const SPLIT_DEFAULT = 50;
/** Arrow-key step for the divider. */
export const SPLIT_STEP = 5;

/**
 * Which shape the current part takes. A null width means the viewport cannot be
 * measured (tests, SSR): keep the CBT split rather than guessing narrow.
 */
export function examLayout(hasPassage: boolean, viewportWidth: number | null): ExamLayout {
  if (!hasPassage) return "single";
  if (viewportWidth == null) return "split";
  return viewportWidth >= EXAM_SPLIT_MIN_WIDTH ? "split" : "stacked";
}

/** Keep a divider position inside its bounds; unusable input falls back to the default. */
export function clampSplit(percent: number): number {
  if (!Number.isFinite(percent)) return SPLIT_DEFAULT;
  return Math.min(SPLIT_MAX, Math.max(SPLIT_MIN, Math.round(percent)));
}

/** CSS grid template for the side-by-side panes: left %, 8px divider, right %. */
export function splitColumns(percent: number): string {
  const left = clampSplit(percent);
  return `${left}% 8px ${100 - left}%`;
}

/** New divider position after a keyboard nudge. Unknown keys change nothing. */
export function nudgeSplit(key: string, percent: number): number {
  const current = clampSplit(percent);
  switch (key) {
    case "ArrowLeft":
      return clampSplit(current - SPLIT_STEP);
    case "ArrowRight":
      return clampSplit(current + SPLIT_STEP);
    case "Home":
      return SPLIT_MIN;
    case "End":
      return SPLIT_MAX;
    default:
      return current;
  }
}

/** What the divider announces to assistive tech. */
export function splitValueText(percent: number): string {
  const left = clampSplit(percent);
  return `${left}% passage, ${100 - left}% questions`;
}

/** localStorage namespace for the divider of one attempt. */
export function splitStorageKey(attemptId: string): string {
  return `examui.split.${attemptId}`;
}

function safeStore(): Storage | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

/**
 * Stored divider position for this attempt, falling back to the default. A
 * student's chosen split is a study preference, so it survives part navigation
 * and a reload instead of snapping back to 50/50.
 */
export function readSplit(attemptId: string, store: Storage | null = safeStore()): number {
  try {
    const raw = store?.getItem(splitStorageKey(attemptId));
    if (!raw) return SPLIT_DEFAULT;
    return clampSplit(Number(raw));
  } catch {
    return SPLIT_DEFAULT;
  }
}

/** Persist the divider position. Storage failures must never disturb the exam. */
export function writeSplit(attemptId: string, percent: number, store: Storage | null = safeStore()): void {
  try {
    store?.setItem(splitStorageKey(attemptId), String(clampSplit(percent)));
  } catch {
    /* private mode / quota — the in-memory position still applies */
  }
}
