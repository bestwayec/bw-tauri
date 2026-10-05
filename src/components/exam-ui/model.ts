import { gapNumbersIn } from "@/components/exam/GappedContent";
import { materialOwnerId, normalizeKind } from "@/lib/exam-types";
import {
  mockGroupAudioUrl,
  resolveMockMediaUrl,
  type MockShapedGroup,
  type MockShapedQuestion,
  type MockShapedSection,
} from "@/lib/mocks";
import { resolveAudioUrl, type RunnerQuestion, type StartResult } from "@/lib/tests";

/**
 * Unified exam model for the IELTS-style runner.
 * Both flows (mock sections + legacy tests) adapt into UIPart[] so there is
 * exactly ONE runner. Pure helpers here are unit-tested (see model.test.ts).
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type UIKind =
  | "single_choice"
  | "multi_select"
  | "tfng"
  | "ynng"
  | "matching"
  | "matching_headings"
  | "map_label"
  | "completion" // sentence/note/summary/table rendered inline when contentHtml exists
  | "short_answer"
  | "essay"
  | "speaking";

export type WidgetId =
  | "radio"
  | "checkbox"
  | "tfng"
  | "ynng"
  | "matching"
  | "map"
  | "inline" // gap inside the gapped document
  | "short"
  | "essay"
  | "speaking";

export interface UIQuestion {
  id: string;
  /** Global 1-based number across the whole section (IELTS 1-40 style). */
  number: number;
  kind: UIKind;
  prompt: string;
  options: string[] | null;
  points: number;
  wordLimit: number | null;
  answerRule?: MockShapedQuestion['answerRule'];
  guidance?: MockShapedQuestion['guidance'];
  recordingContext?: { attemptId: string; timed: boolean; hasAudio: boolean; profileVersion?: string | null };
}

export interface UIPart {
  key: string;
  /**
   * Reading-marks owner for server sync (legacy tests: the passage-owner
   * question id). Absent in the mock flow, where marks stay on-device.
   */
  marksKey?: string;
  /** "Part 1" / "Passage 2" tab label. */
  label: string;
  title: string | null;
  instructions: string | null;
  passageText: string | null;
  contentHtml: string | null;
  contentLayout?: string | null;
  optionsReusable?: boolean | null;
  audioUrl: string | null;
  imageUrl: string | null;
  /** Timed listening: play once, no pause/seek. */
  strictAudio: boolean;
  multilevelAudio?: { attemptId: string; groupId: string };
  questions: UIQuestion[];
}

// ---------------------------------------------------------------------------
// Widget mapping (pure)
// ---------------------------------------------------------------------------

export function widgetFor(kind: UIKind, hasOptions: boolean): WidgetId {
  switch (kind) {
    case "single_choice":
      return "radio";
    case "multi_select":
      return "checkbox";
    case "tfng":
      return "tfng";
    case "ynng":
      return "ynng";
    case "matching":
    case "matching_headings":
      return hasOptions ? "matching" : "short";
    case "map_label":
      return hasOptions ? 'map' : 'short';
    case "completion":
      return "inline";
    case "essay":
      return "essay";
    case "speaking":
      return "speaking";
    case "short_answer":
    default:
      return "short";
  }
}

/** Map a backend mock question type onto a UIKind. */
export function mockKindOf(t: MockShapedQuestion["type"]): UIKind {
  switch (t) {
    case "multiple_choice":
      return "single_choice";
    case "multi_select":
      return "multi_select";
    case "true_false_notgiven":
      return "tfng";
    case "yes_no_notgiven":
      return "ynng";
    case "matching":
      return "matching";
    case "matching_headings":
      return "matching_headings";
    case "map_labelling":
      return "map_label";
    case "sentence_completion":
    case "note_completion":
    case "summary_completion":
    case "table_completion":
      return "completion";
    case "essay_task1":
    case "essay_task2":
      return "essay";
    case "speaking_task":
      return "speaking";
    case "short_answer":
    default:
      return "short_answer";
  }
}

/** Map a legacy test question onto a UIKind via the shared kind normalizer. */
export function legacyKindOf(q: RunnerQuestion): UIKind {
  const k = normalizeKind(q);
  switch (k) {
    case "multiple_choice":
      return "single_choice";
    case "tfng":
      return "tfng";
    case "ynng":
      return "ynng";
    case "matching":
      return "matching";
    case "map_label":
      return "map_label";
    case "essay":
      return "essay";
    case "speaking_prompt":
      return "speaking";
    case "gap_fill":
    case "short_answer":
    default:
      return "short_answer";
  }
}

// ---------------------------------------------------------------------------
// Adapters
// ---------------------------------------------------------------------------

function partLabel(skill: string, idx: number): string {
  const s = skill.toLowerCase();
  if (s.includes("read")) return `Passage ${idx + 1}`;
  if (s.includes("writ")) return `Task ${idx + 1}`;
  if (s.includes("speak")) return `Part ${idx + 1}`;
  return `Part ${idx + 1}`;
}

/** Mock section -> parts (one backend group per part), global numbering. */
export function mockSectionToParts(
  section: MockShapedSection,
  attemptId: string,
  timed: boolean,
): UIPart[] {
  const groups = [...section.groups].sort((a, b) => a.sortOrder - b.sortOrder);
  let n = 0;
  return groups.map((g: MockShapedGroup, gi: number) => {
    const questions: UIQuestion[] = [...g.questions]
      .sort((a, b) => a.sortOrder - b.sortOrder || a.number - b.number)
      .map((q) => ({ ...toUIQuestion(q), number: ++n }));
    return {
      key: g.id,
      label: section.skill === 'speaking' && g.questions[0]?.guidance?.taskKey ? `Part ${g.questions[0].guidance.taskKey}` : g.contentLayout === 'multi_extract' ? `Extract ${gi + 1}` : partLabel(section.skill, gi),
      title: g.title,
      instructions: g.instructions,
      passageText: g.passageText,
      contentHtml: g.contentHtml,
      contentLayout: g.contentLayout,
      optionsReusable: g.optionsReusable,
      audioUrl: mockGroupAudioUrl(g, attemptId, timed && section.skill === "listening"),
      imageUrl: resolveMockMediaUrl(g.imageUrl),
      strictAudio: timed && section.skill === "listening" && !!g.audioUrl,
      ...(g.questions[0]?.guidance && timed && section.skill === 'listening' ? { multilevelAudio: { attemptId, groupId: g.id } } : {}),
      questions,
    };
  });
}

function toUIQuestion(q: MockShapedQuestion): Omit<UIQuestion, "number"> {
  return {
    id: q.id,
    kind: mockKindOf(q.type),
    prompt: q.prompt,
    options: q.options,
    points: q.points,
    wordLimit: q.wordLimit,
    answerRule: q.answerRule,
    guidance: q.guidance,
  };
}

/**
 * Legacy test attempt -> parts by grouping consecutive questions that share
 * section + audio (same rule as the old Runner, minus its UI).
 */
export function legacyStartToParts(start: StartResult): UIPart[] {
  const parts: UIPart[] = [];
  // Parallel owner-item lists for reading-marks server sync.
  const owners: Array<Array<{ q: Pick<RunnerQuestion, "id" | "passageText"> }>> = [];
  let n = 0;
  for (const q of start.questions) {
    const audioKey = q.audioUrl ?? (q.hasAudio ? `flag:${q.id}` : "none");
    const key = `${q.section}::${audioKey}`;
    const last = parts[parts.length - 1];
    const ui: UIQuestion = {
      id: q.id,
      number: ++n,
      kind: legacyKindOf(q),
      prompt: q.prompt,
      options: q.options,
      points: q.maxScore,
      wordLimit: q.wordLimit ?? null,
    };
    if (last && last.key === key) {
      last.questions.push(ui);
      owners[owners.length - 1].push({ q });
      if (!last.instructions && q.instructions) last.instructions = q.instructions;
      if (!last.passageText && q.passageText) last.passageText = q.passageText;
    } else {
      parts.push({
        key,
        marksKey: undefined,
        label: partLabel(q.section, parts.length),
        title: null,
        instructions: q.instructions ?? null,
        passageText: q.passageText ?? null,
        contentHtml: null,
        audioUrl: resolveAudioUrl(q.audioUrl),
        imageUrl: null,
        strictAudio: false,
        questions: [ui],
      });
      owners.push([{ q }]);
    }
  }
  parts.forEach((part, i) => {
    part.marksKey = materialOwnerId(owners[i]) ?? undefined;
  });
  return parts;
}

// ---------------------------------------------------------------------------
// Navigation state (pure)
// ---------------------------------------------------------------------------

export type QState = "answered" | "unanswered" | "flagged" | "current";

export function questionState(
  index: number,
  current: number,
  answered: boolean,
  flagged: boolean,
): QState {
  if (index === current) return "current";
  if (flagged) return "flagged";
  return answered ? "answered" : "unanswered";
}

export function isAnswered(value: string | undefined, audioDone: boolean): boolean {
  return audioDone || (value ?? "").trim().length > 0;
}

/** Next unanswered question index after `from` (wraps), or null when all done. */
export function nextUnanswered(total: number, from: number, answered: boolean[]): number | null {
  for (let step = 1; step <= total; step++) {
    const i = (from + step) % total;
    if (!answered[i]) return i;
  }
  return null;
}

/** Question numbers inside a gapped doc that have no backend question (data bug). */
export function orphanGaps(contentHtml: string, numbers: number[]): number[] {
  const set = new Set(numbers);
  return gapNumbersIn(contentHtml).filter((n) => !set.has(n));
}

// ---------------------------------------------------------------------------
// Server-time deadlines (pure)
// ---------------------------------------------------------------------------

/** Client clock skew vs the server: positive when the client is behind. */
export function serverOffsetMs(serverIso: string, clientNow: number = Date.now()): number {
  const t = new Date(serverIso).getTime();
  return Number.isNaN(t) ? 0 : t - clientNow;
}

/** Milliseconds left until an ISO deadline, corrected for clock skew. Null = untimed. */
export function remainingMs(
  deadlineIso: string | null | undefined,
  offsetMs: number,
  now: number = Date.now(),
): number | null {
  if (!deadlineIso) return null;
  const t = new Date(deadlineIso).getTime();
  if (Number.isNaN(t)) return null;
  return t - (now + offsetMs);
}

export function fmtCountdown(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const mm = h > 0 ? String(m).padStart(2, "0") : String(m);
  return `${h > 0 ? `${h}:` : ""}${mm}:${String(s).padStart(2, "0")}`;
}
