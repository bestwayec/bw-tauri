import { resolveBackendMediaUrl } from './media-url';
/**
 * Student test-exam client for the Tauri app.
 *
 * Backend (backend/src/tests):
 * - GET  /tests?page=&limit=      -> TestListItem[] (active only for students)
 * - POST /tests/:id/start         -> StartResult (resumes in_progress attempt)
 * - POST /tests/attempts/:id/answer  { questionId, answer }
 * - POST /tests/attempts/:id/submit
 * - GET  /tests/attempts/mine
 *
 * api.ts `request()` already unwraps `{ success, data }` -> `data`,
 * and the list endpoint goes through TransformInterceptor
 * (Paginated -> `{ data: items[], meta }`), so callers get the array directly.
 */
import { get, post } from "./api";
import { TestListSchema, parseOrThrow } from "./schemas";
import type { ExamProgram, PracticeLevel } from './programs';

export type TestSection = "listening" | "reading" | "writing" | "speaking";
export type QuestionType =
  | "multiple_choice"
  | "short_answer"
  | "essay"
  | "speaking_prompt";

export interface TestListItem {
  id: string;
  type: string;
  title: string;
  level: string | null;
  practiceLevel?: PracticeLevel | null;
  isDemo: boolean;
  isActive: boolean;
  durationMinutes: number | null;
  questionCount: number;
  sections: TestSection[];
}

export interface RunnerQuestion {
  id: string;
  section: TestSection;
  type: QuestionType;
  prompt: string;
  options: string[] | null;
  maxScore: number;
  passageText?: string | null;
  instructions?: string | null;
  /** Sanitized path like `/v1/tests/questions/:id/audio`, or null. */
  audioUrl?: string | null;
  hasAudio?: boolean;
  /**
   * Forward-compatible practice-platform fields (all optional — older
   * backends omit them and the runner infers from `type` + `options`).
   * - kind: explicit widget kind (tfng, ynng, gap_fill, matching, map_label…)
   * - wordLimit: strict max words for completion answers
   * - explanation / anchorPassage / anchorAudioSec: review "Locate & Explain"
   */
  kind?: string | null;
  wordLimit?: number | null;
  explanation?: string | null;
  anchorPassage?: string | null;
  anchorAudioSec?: number | null;
}

export interface StartResult {
  attemptId: string;
  resumed: boolean;
  durationMinutes: number | null;
  startedAt: string;
  questions: RunnerQuestion[];
  savedAnswers?: Record<string, string>;
  /** Server-side reading aids: passage-owner questionId -> marks. Absent on old backends. */
  savedMarks?: Record<string, { highlights: string[]; note: string | null }>;
}

/** Active tests visible to the signed-in student. Validated against the backend shape. */
export async function listTests(limit = 50, program?: ExamProgram): Promise<TestListItem[]> {
  const raw = await get<unknown>("/tests", { limit, program });
  return parseOrThrow("GET /tests", TestListSchema, raw);
}

export function startTest(testId: string): Promise<StartResult> {
  return post<StartResult>(`/tests/${encodeURIComponent(testId)}/start`, {});
}

export function saveAnswer(
  attemptId: string,
  questionId: string,
  answer: string,
): Promise<{ saved: boolean }> {
  return post<{ saved: boolean }>(
    `/tests/attempts/${encodeURIComponent(attemptId)}/answer`,
    { questionId, answer },
  );
}

export function submitAttempt(attemptId: string): Promise<{
  status: string;
  autoScore: number;
}> {
  return post(`/tests/attempts/${encodeURIComponent(attemptId)}/submit`, {});
}

/**
 * Save reading highlights + private note for one question (the part's
 * passage owner). Never touches the answer text. Local-first: callers must
 * persist to localStorage too and treat server failure as offline.
 */
export function saveMarks(
  attemptId: string,
  questionId: string,
  marks: { highlights: string[]; note: string },
): Promise<{ saved: boolean }> {
  return post<{ saved: boolean }>(
    `/tests/attempts/${encodeURIComponent(attemptId)}/marks`,
    { questionId, highlights: marks.highlights, note: marks.note },
  );
}

export type AttemptStatus = "in_progress" | "grading" | "completed";

export interface AttemptSummary {
  id: string;
  studentId: string;
  studentName?: string | null;
  testId: string;
  testTitle?: string | null;
  testType?: string | null;
  status: AttemptStatus;
  autoScore: number | null;
  manualScore: number | null;
  totalScore: number | null;
  antiCheatCount?: number | null;
  startedAt: string;
  finishedAt: string | null;
}

/** Own result history for the signed-in student (newest first). */
export async function myAttempts(limit = 50, program?: ExamProgram): Promise<AttemptSummary[]> {
  const data = await get<AttemptSummary[] | { data: AttemptSummary[] }>("/tests/attempts/mine", {
    limit,
    program,
  });
  // request() unwraps `{success,data}` but Paginated may nest once more.
  if (Array.isArray(data)) return data;
  if (data && Array.isArray((data as { data?: unknown }).data)) {
    return (data as { data: AttemptSummary[] }).data;
  }
  return [];
}

/**
 * Per-question review for one attempt (Locate & Explain).
 * Backend exposes `correctAnswer`/`isCorrect` to the owner only after submit;
 * while `in_progress` those fields are absent — the UI must handle that.
 */
export interface AttemptReviewItem {
  order: number;
  questionId: string;
  section: TestSection;
  type: string;
  prompt: string;
  options: string[] | null;
  maxScore: number;
  passageText?: string | null;
  instructions?: string | null;
  hasAudio?: boolean;
  audioUrl?: string | null;
  correctAnswer?: string | null;
  isCorrect?: boolean | null;
  /** Server-side reading aids (owner + staff only). */
  highlights?: string[] | null;
  note?: string | null;
  answer: string | null;
  score: number | null;
  isGraded: boolean;
  comment?: string | null;
}

export interface AttemptReview extends AttemptSummary {
  questions: AttemptReviewItem[];
}

export function getAttemptReview(attemptId: string): Promise<AttemptReview> {
  return get<AttemptReview>(`/tests/attempts/${encodeURIComponent(attemptId)}`);
}

/**
 * Turn the backend's sanitized audio path into a fetchable absolute URL.
 * Backend returns `/v1/tests/questions/:id/audio`; API_BASE_URL already
 * ends with `/v1`, so strip the prefix before joining.
 *
 * Security: only allow backend-relative paths or absolute URLs on the exact
 * API origin. Prevents a compromised backend payload from
 * exfiltrating to an attacker host via crafted audioUrl.
 */
export const resolveAudioUrl = resolveBackendMediaUrl;
