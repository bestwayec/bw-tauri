/**
 * Practice-platform exam model for the desktop runner.
 *
 * Extends the server `RunnerQuestion` (lib/tests.ts) with optional
 * forward-compatible fields. Everything here degrades gracefully:
 * unknown/missing `kind` falls back to the legacy `type`.
 */
import type { RunnerQuestion } from "./tests";

export type ExamKind =
  | "multiple_choice"
  | "tfng"
  | "ynng"
  | "gap_fill"
  | "matching"
  | "map_label"
  | "short_answer"
  | "essay"
  | "speaking_prompt";

export type ExamSection = RunnerQuestion["section"];

/** Backend may send `kind` directly; older payloads only have `type` + `options`. */
type QuestionLike = RunnerQuestion & { kind?: unknown; wordLimit?: unknown };

const TRUE_FALSE_NG = ["true", "false", "not given"];
const YES_NO_NG = ["yes", "no", "not given"];

function normOptions(options: string[] | null | undefined): string[] {
  return (options ?? []).map((o) => o.trim().toLowerCase());
}

function looksLike(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const set = new Set(a);
  return b.every((x) => set.has(x));
}

/**
 * Resolve the answer widget kind. Prefers explicit `kind` from the backend,
 * otherwise infers TFNG/YNNG from option labels and gap-fill from prompt
 * markers (___ / [...] gaps). Never throws — falls back to legacy `type`.
 */
export function normalizeKind(q: QuestionLike): ExamKind {
  const raw = typeof q.kind === "string" ? q.kind.trim().toLowerCase() : "";
  switch (raw) {
    case "multiple_choice":
    case "mcq":
      return "multiple_choice";
    case "tfng":
    case "true_false_not_given":
      return "tfng";
    case "ynng":
    case "yes_no_not_given":
      return "ynng";
    case "gap_fill":
    case "gap-fill":
    case "completion":
      return "gap_fill";
    case "matching":
      return "matching";
    case "map_label":
    case "map":
    case "diagram":
      return "map_label";
    case "short_answer":
      return "short_answer";
    case "essay":
      return "essay";
    case "speaking_prompt":
      return "speaking_prompt";
    default:
      break;
  }
  // Inference for legacy payloads.
  if (Array.isArray(q.options) && q.options.length > 0) {
    const opts = normOptions(q.options);
    if (looksLike(opts, TRUE_FALSE_NG)) return "tfng";
    if (looksLike(opts, YES_NO_NG)) return "ynng";
    // 2-6 short options + MCQ-ish type => multiple choice.
    if (q.type === "multiple_choice") return "multiple_choice";
    // Long option lists with "match" in the prompt are usually matching tasks.
    if (/match/i.test(q.prompt) && q.options.length >= 4) return "matching";
    return "multiple_choice";
  }
  if (q.type === "essay" || q.type === "speaking_prompt") return q.type;
  // Gap markers in prompt with no options => gap-fill / short answer.
  if (/_{2,}|\[…\]|\[gap\]/i.test(q.prompt)) return "gap_fill";
  return "short_answer";
}

export function kindLabel(kind: ExamKind): string {
  switch (kind) {
    case "multiple_choice":
      return "Multiple choice";
    case "tfng":
      return "True / False / Not Given";
    case "ynng":
      return "Yes / No / Not Given";
    case "gap_fill":
      return "Completion";
    case "matching":
      return "Matching";
    case "map_label":
      return "Labelling";
    case "short_answer":
      return "Short answer";
    case "essay":
      return "Writing";
    case "speaking_prompt":
      return "Speaking";
  }
}

export function helpTextFor(kind: ExamKind): string {
  switch (kind) {
    case "tfng":
      return "Choose TRUE if the statement agrees with the passage, FALSE if it contradicts it, NOT GIVEN if the passage does not say.";
    case "ynng":
      return "Choose YES if the statement agrees with the writer's views, NO if it contradicts them, NOT GIVEN if no view is given.";
    case "multiple_choice":
      return "Choose one answer. Click an option to save it — clicking again keeps it saved.";
    case "gap_fill":
      return "Type your answer in the box. Respect the word limit (e.g. NO MORE THAN TWO WORDS) — extra words score 0.";
    case "matching":
      return "Match each item to the correct option from the list.";
    case "map_label":
      return "Choose the correct label for each numbered part of the map or diagram.";
    case "short_answer":
      return "Type a short answer. Spelling and grammar must be exact.";
    case "essay":
      return "Write full sentences. Watch the live word count — Task 1 needs 150+ words, Task 2 needs 250+ words.";
    case "speaking_prompt":
      return "Speak or draft your notes here. This part is graded manually by your teacher.";
  }
}

/** Word-limit helpers (report: limits like "NO MORE THAN TWO WORDS" are strict). */
export function countWords(text: string): number {
  const t = text.trim();
  if (!t) return 0;
  return t.split(/\s+/).filter(Boolean).length;
}

export function wordLimitFor(q: QuestionLike): number | null {
  if (typeof q.wordLimit === "number" && Number.isFinite(q.wordLimit) && q.wordLimit > 0) {
    return Math.floor(q.wordLimit);
  }
  const m = q.instructions?.match(/no more than (\w+) words?/i) ?? q.prompt.match(/no more than (\w+) words?/i);
  if (!m) return null;
  const wordNums: Record<string, number> = {
    one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7,
  };
  const raw = m[1].toLowerCase();
  if (/^\d+$/.test(raw)) return parseInt(raw, 10);
  return wordNums[raw] ?? null;
}

/** Parse "NO MORE THAN X WORDS AND/OR A NUMBER" style hint for display. */
export function wordLimitHint(q: QuestionLike): string | null {
  const limit = wordLimitFor(q);
  if (limit == null) return null;
  return limit === 1 ? "NO MORE THAN ONE WORD" : `NO MORE THAN ${limit} WORDS`;
}

/* ---------- flag-for-review persistence (local, per attempt) ---------- */

function flagKey(attemptId: string): string {
  return `bestway.examFlags.${attemptId}`;
}

export function loadFlags(attemptId: string): Record<string, boolean> {
  try {
    const raw = localStorage.getItem(flagKey(attemptId));
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, boolean>;
    return typeof parsed === "object" && parsed !== null ? parsed : {};
  } catch {
    return {};
  }
}

export function saveFlags(attemptId: string, flags: Record<string, boolean>): void {
  try {
    localStorage.setItem(flagKey(attemptId), JSON.stringify(flags));
  } catch {
    /* private mode — session-only */
  }
}

/* ---------- reading marks (highlights + notes): local + server ---------- */

export interface PartMarks {
  highlights: string[];
  note: string;
}

const MARKS_PREFIX = "bestway.highlights.";

function marksKey(attemptId: string, partIdx: number): string {
  return `${MARKS_PREFIX}${attemptId}.p${partIdx}`;
}

/** Local-first read (offline-safe). Keys match the pre-server format. */
export function loadPartMarks(attemptId: string, partIdx: number): PartMarks {
  try {
    const raw = localStorage.getItem(marksKey(attemptId, partIdx));
    const note = localStorage.getItem(marksKey(attemptId, partIdx) + ".note") ?? "";
    const arr = raw ? JSON.parse(raw) : [];
    return {
      highlights: Array.isArray(arr) ? arr.filter((x) => typeof x === "string") : [],
      note: typeof note === "string" ? note : "",
    };
  } catch {
    return { highlights: [], note: "" };
  }
}

export function savePartMarks(attemptId: string, partIdx: number, marks: PartMarks): void {
  try {
    localStorage.setItem(marksKey(attemptId, partIdx), JSON.stringify(marks.highlights));
    localStorage.setItem(marksKey(attemptId, partIdx) + ".note", marks.note);
  } catch {
    /* private mode — session-only */
  }
}

/** Union server marks into local ones (local edits win ties on note). */
export function mergeMarks(
  local: PartMarks,
  server: { highlights: string[]; note: string | null } | undefined,
): PartMarks {
  if (!server) return local;
  const seen = new Set(local.highlights);
  const highlights = [...local.highlights];
  for (const h of server.highlights) {
    if (typeof h === "string" && h && !seen.has(h)) {
      seen.add(h);
      highlights.push(h);
    }
  }
  return {
    highlights: highlights.slice(0, 50),
    note: local.note || server.note || "",
  };
}

/**
 * Passage-owner question for a part: first item carrying passageText,
 * else the first item. Both runner and server-mapping must use this so
 * marks load/save hit the same Answer row.
 */
export function materialOwnerId(
  items: { q: Pick<RunnerQuestion, "id" | "passageText"> }[],
): string | null {
  if (items.length === 0) return null;
  return items.find((it) => it.q.passageText)?.q.id ?? items[0].q.id;
}

/* ---------- reading font-size preference ---------- */

const FONT_KEY = "bestway.examFontSize";

export function getExamFontSize(): number {
  try {
    const raw = Number(localStorage.getItem(FONT_KEY) ?? "15");
    if (!Number.isFinite(raw)) return 15;
    return Math.min(20, Math.max(12, raw));
  } catch {
    return 15;
  }
}

export function setExamFontSize(px: number): void {
  try {
    localStorage.setItem(FONT_KEY, String(Math.min(20, Math.max(12, px))));
  } catch {
    /* ignore */
  }
}

/* ---------- approximate raw→band for Listening / Academic Reading ---------- */

export function rawToBand(raw: number, total = 40): number {
  const pct = total > 0 ? raw / total : 0;
  if (pct >= 39 / 40) return 9;
  if (pct >= 37 / 40) return 8.5;
  if (pct >= 35 / 40) return 8;
  if (pct >= 32 / 40) return 7.5;
  if (pct >= 30 / 40) return 7;
  if (pct >= 26 / 40) return 6.5;
  if (pct >= 23 / 40) return 6;
  if (pct >= 18 / 40) return 5.5;
  if (pct >= 16 / 40) return 5;
  if (pct >= 13 / 40) return 4.5;
  if (pct >= 10 / 40) return 4;
  return 3.5;
}
