import { gapNumbersIn } from "@/components/exam/GappedContent";
import { materialOwnerId, normalizeKind } from "@/lib/exam-types";
import {
  mockGroupAudioUrl,
  normalizeMockSection,
  resolveMockMediaUrl,
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

export type SimulatorMode = "cdi" | "dtm";
export type ContrastTheme = "app" | "standard" | "dark" | "grey";

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
  audioStartSec?: number | null;
  stimulusRef?: string | null;
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
export function mockKindOf(t: MockShapedQuestion["type"] | string | undefined | null): UIKind {
  switch (t) {
    case "single_choice":
    case "multiple_choice":
    case "mcq":
      return "single_choice";
    case "multi_select":
      return "multi_select";
    case "true_false_notgiven":
    case "true_false_ng":
    case "true_false":
    case "tfng":
      return "tfng";
    case "yes_no_notgiven":
    case "ynng":
      return "ynng";
    case "matching":
    case "speaker_matching":
    case "matching_statements":
      return "matching";
    case "matching_headings":
      return "matching_headings";
    case "map_labelling":
    case "map_labeling":
    case "map_dropdown":
    case "map_label":
      return "map_label";
    case "sentence_completion":
    case "note_completion":
    case "summary_completion":
    case "table_completion":
    case "in_text_blank":
    case "gap_fill":
    case "completion":
      return "completion";
    case "essay":
    case "essay_task1":
    case "essay_task2":
      return "essay";
    case "speaking":
    case "speaking_task":
    case "speaking_prompt":
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

/** Extract a non-negative audio start timestamp (seconds) from audioStartSec or stimulusRef JSON. */
export function parseAudioStartSec(
  audioStartSec?: number | null,
  stimulusRef?: string | Record<string, unknown> | null,
): number | null {
  if (typeof audioStartSec === "number" && Number.isFinite(audioStartSec) && audioStartSec >= 0) {
    return audioStartSec;
  }
  if (!stimulusRef) return null;
  try {
    const obj = typeof stimulusRef === "string" ? (JSON.parse(stimulusRef) as Record<string, unknown>) : stimulusRef;
    if (obj && typeof obj === "object") {
      const candidate = obj.startSec ?? obj.audioStartSec ?? obj.start_sec;
      if (typeof candidate === "number" && Number.isFinite(candidate) && candidate >= 0) {
        return candidate;
      }
      if (typeof candidate === "string" && candidate.trim() !== "") {
        const parsed = Number(candidate);
        if (Number.isFinite(parsed) && parsed >= 0) return parsed;
      }
    }
  } catch {
    /* ignore non-JSON stimulusRef */
  }
  return null;
}

/** Official DTM Bottom Question Palette status classes. */
export function dtmQuestionColorClass(answered: boolean, flagged: boolean, isCurrent = false): string {
  const base = flagged
    ? "bg-amber-400 text-slate-950"
    : answered
      ? "bg-emerald-600 text-white"
      : "bg-slate-600/40 text-slate-200";
  return isCurrent ? `${base} ring-2 ring-white` : base;
}

/** CDI 3-contrast theme metadata. */
export function contrastThemePalette(theme: ContrastTheme): { bg: string; text: string; label: string } {
  switch (theme) {
    case "dark":
      return { bg: "#09090b", text: "#fef08a", label: "High Contrast" };
    case "grey":
      return { bg: "#2d3139", text: "#f8fafc", label: "Soft Grey" };
    case "app":
      return { bg: "#0B0F17", text: "#f3f4f6", label: "Bestway Dark" };
    case "standard":
    default:
      return { bg: "#f4f4f1", text: "#111111", label: "Standard" };
  }
}

/** Mock section -> parts (one backend group per part), global numbering. */
export function mockSectionToParts(
  section: MockShapedSection,
  attemptId: string,
  timed: boolean,
): UIPart[] {
  const norm = normalizeMockSection(section);
  const groups = norm.groups;
  let n = 0;
  return groups.map((g: any, gi: number) => {
    const rawQuestions = (g?.questions || []);
    const questions: UIQuestion[] = [...rawQuestions]
      .sort((a: any, b: any) => (a.sortOrder ?? a.order ?? 0) - (b.sortOrder ?? b.order ?? 0) || (a.number ?? a.question_number ?? 0) - (b.number ?? b.question_number ?? 0))
      .map((q) => ({ ...toUIQuestion(q), number: ++n }));
    const startSec = parseAudioStartSec(g.audioStartSec, g.stimulusRef);
    return {
      key: g.id || g.key || `part-${gi + 1}`,
      label: (norm.skill === 'speaking' || norm.skill === 'writing') && questions[0]?.guidance
        ? questions[0].guidance.displayLabel ?? `Part ${questions[0].guidance.taskKey}`
        : g.contentLayout === 'multi_extract' ? `Extract ${gi + 1}` : (g.label || partLabel(norm.skill || 'listening', gi)),
      title: g.title ?? null,
      instructions: g.instructions ?? null,
      passageText: g.passageText ?? g.contentHtml ?? null,
      contentHtml: g.contentHtml ?? g.passageText ?? null,
      contentLayout: g.contentLayout ?? null,
      optionsReusable: g.optionsReusable,
      audioUrl: mockGroupAudioUrl(g, attemptId, timed && norm.skill === "listening") ?? g.audioUrl ?? null,
      ...(startSec != null ? { audioStartSec: startSec } : {}),
      ...(g.stimulusRef ? { stimulusRef: g.stimulusRef } : {}),
      imageUrl: g.imageUrl ? resolveMockMediaUrl(g.imageUrl) : null,
      strictAudio: timed && norm.skill === "listening" && !!(mockGroupAudioUrl(g, attemptId, true) || g.audioUrl || g.audioKey),
      ...(questions[0]?.guidance && timed && norm.skill === 'listening' ? { multilevelAudio: { attemptId, groupId: g.id } } : {}),
      questions,
    };
  });
}

function toUIQuestion(q: any): Omit<UIQuestion, "number"> {
  let options: string[] | null = null;
  const rawOpts = q.options ?? (q.payload?.options ?? null);
  if (Array.isArray(rawOpts)) {
    options = rawOpts.map((opt) => (typeof opt === "string" ? opt : (opt as any)?.text ?? (opt as any)?.label ?? (opt as any)?.value ?? String(opt)));
  } else if (rawOpts && typeof rawOpts === "object") {
    options = Object.values(rawOpts).map((v) => (typeof v === "string" ? v : String(v)));
  }

  return {
    id: String(q.id ?? q._id ?? q.question_id ?? ""),
    kind: mockKindOf(q.kind || q.type || q.question_type || q.questionType),
    prompt: q.prompt ?? q.text ?? q.question ?? "",
    options,
    points: q.points ?? q.maxScore ?? q.max_score ?? 1,
    wordLimit: q.wordLimit ?? (q.word_limit ?? (q.payload?.wordLimit ?? null)),
    answerRule: q.answerRule ?? q.answer_rule ?? q.payload?.answerRule,
    guidance: q.guidance ?? q.payload?.guidance,
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

/**
 * Merge newly uploaded recordings into the runner's answered-audio map.
 * A take that reached the server stays answered, so entries are only ever
 * added. Returns the same object when nothing changed (no rerender).
 */
export function mergeAudioDone(
  previous: Record<string, boolean>,
  incoming: Record<string, boolean> | undefined,
): Record<string, boolean> {
  if (!incoming) return previous;
  let changed = false;
  const next = { ...previous };
  for (const [questionId, done] of Object.entries(incoming)) {
    if (done && !next[questionId]) {
      next[questionId] = true;
      changed = true;
    }
  }
  return changed ? next : previous;
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
