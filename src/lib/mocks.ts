import { resolveBackendMediaUrl } from './media-url';
/**
 * Mock exam client for the Tauri app (section-by-section IELTS flow).
 *
 * Backend: backend/src/mock (prefix /v1/mock/*).
 * - GET  /mock/exams                       -> MockExamListItem[] (student: published/demo)
 * - GET  /mock/exams/:id                   -> shaped exam (student: sanitized, needs access)
 * - POST /mock/exams/:id/start {mode?,flow?} -> MockStartResult (resumes in_progress)
 * - POST /mock/attempts/:id/answer {questionId,response}
 * - POST /mock/attempts/:id/answers {answers:[...]} (1-200)
 * - POST /mock/attempts/:id/speaking/:questionId (multipart audio <=25MB)
 * - POST /mock/attempts/:id/submit {skills?} -> section-only grading when skills set
 * - GET  /mock/attempts/mine
 * - GET  /mock/attempts/:id               -> detail (keys only when completed)
 * - GET  /mock/groups/:groupId/audio?attemptId= (Range; timed replay-counted)
 * - GET  /mock/groups/:groupId/image
 *
 * api.ts `request()` already unwraps `{ success, data }` -> `data`.
 */
import { del, get, post } from "./api";
import type { ExamProgram, PracticeLevel } from './programs';
import {
  MockExamListSchema,
  MockStartResultSchema,
  MockSubmitResultSchema,
  parseOrThrow,
} from "./schemas";

export type MockExamType = "ielts_academic" | "ielts_general" | "multilevel";
export type MockSkill = "listening" | "reading" | "writing" | "speaking";
export type MockAccess = "granted" | "pending" | "locked";
export type MockAttemptMode = "practice" | "timed";
export type MockAttemptStatus = "in_progress" | "grading" | "completed";

export interface MockExamListItem {
  profile?: "practice" | "full_mock";
  id: string;
  type: MockExamType;
  title: string;
  description: string | null;
  level: string | null;
  practiceLevel?: PracticeLevel | null;
  isDemo: boolean;
  isPublished: boolean;
  /** Backend-authoritative start readiness. */
  ready?: boolean;
  skills: MockSkill[];
  questionCount: number;
  durationMinutes: number | null;
  price: number;
  access: MockAccess;
}

export type MockQuestionType =
  | "multiple_choice"
  | "multi_select"
  | "true_false_notgiven"
  | "yes_no_notgiven"
  | "matching"
  | "matching_headings"
  | "sentence_completion"
  | "note_completion"
  | "summary_completion"
  | "table_completion"
  | "short_answer"
  | "map_labelling"
  | "essay_task1"
  | "essay_task2"
  | "speaking_task";

export interface MockShapedQuestion {
  id: string;
  number: number;
  sortOrder: number;
  type: MockQuestionType;
  prompt: string;
  options: string[] | null;
  points: number;
  wordLimit: number | null;
  answerRule?: 'ONE_WORD' | 'ONE_WORD_AND_OR_NUMBER' | null;
  guidance?: { taskKey: string; displayLabel?: string; wordMin?: number; wordMax?: number; prepSeconds?: number; responseSeconds?: number; speakingProfileVersion?: string | null; profileLabel?: string; rawMax?: number };
}

export interface MockShapedGroup {
  id: string;
  sortOrder: number;
  title: string | null;
  instructions: string | null;
  passageText: string | null;
  /** Sanitized rich document with `<span data-gap="N"></span>` tokens (null = no gapped doc). */
  contentHtml: string | null;
  /** Layout hint for the gapped document (e.g. notes/table/summary). Null = default. */
  contentLayout: string | null;
  /** Null/absent preserves the legacy one-use matching interaction. */
  optionsReusable?: boolean | null;
  hasAudio: boolean;
  /** Sanitized path like `/v1/mock/groups/:id/audio`, or null. */
  audioUrl: string | null;
  imageUrl: string | null;
  partNumber: number | null;
  audioDurationSec: number | null;
  audioStartSec?: number | null;
  stimulusRef?: string | null;
  audioPlayLimit: number;
  questions: MockShapedQuestion[];
}

export interface MockShapedSection {
  id: string;
  skill: MockSkill;
  title: string | null;
  sortOrder: number;
  durationMinutes: number | null;
  instructions: string | null;
  groups: MockShapedGroup[];
}

export interface MockShapedExam {
  id: string;
  type: MockExamType;
  profile?: string;
  specificationVersion?: string;
  speakingProfileVersion?: string | null;
  speakingProfile?: { version: string; isOfficialTiming: boolean; parts: Array<{ key: string; prepSeconds: number[]; responseSeconds: number[] }> };
  title: string;
  description: string | null;
  level: string | null;
  practiceLevel?: PracticeLevel | null;
  isPublished: boolean;
  isDemo: boolean;
  createdAt: string;
  updatedAt: string;
  questionCount: number;
  sections: MockShapedSection[];
}

export interface MockStartResult {
  attemptId: string;
  resumed: boolean;
  mode: MockAttemptMode;
  simulatorMode?: "cdi" | "dtm" | null;
  startedAt: string;
  deadlineAt: string | null;
  serverTime: string;
  durationMinutes: number | null;
  flowMode: "single_skill" | "full_test";
  currentSkill: MockSkill | null;
  sectionDeadlines: Partial<Record<MockSkill, string>> | null;
  overallDeadlineAt: string | null;
  exam: MockShapedExam;
  annotations: unknown[];
  savedAnswers: Record<string, string>;
  /**
   * Single-section practice metadata. The backend scopes `exam.sections` to the
   * chosen skill for these attempts, so no other section is ever downloaded.
   */
  isSingleSection?: boolean;
  singleSection?: MockSkill | null;
  attemptTypeLabel?: string;
}

/**
 * The one section this attempt is allowed to answer, or null for a full mock.
 * Read from the server response first (authoritative scope), then fall back to
 * a single scoped section. Used by App routing and the runner submit path.
 */
export function singleSectionOf(start: Pick<MockStartResult, 'isSingleSection' | 'singleSection' | 'flowMode' | 'exam'>): MockSkill | null {
  if (start.isSingleSection && start.singleSection) return start.singleSection;
  if (start.flowMode === 'full_test') return null;
  return start.exam.sections.length === 1 ? start.exam.sections[0].skill : null;
}

/**
 * `skills` argument for the submit call of `skill`.
 *
 * A single-section attempt is already scoped server-side, so it is submitted
 * as-is — the sections the student did not choose are never required (the
 * server skips its completeness check for these attempts). Multi-section
 * attempts still declare the section being finished so grading stays
 * section-only.
 */
export function submitSkillsFor(
  start: Pick<MockStartResult, 'isSingleSection' | 'singleSection' | 'flowMode' | 'exam'>,
  skill: MockSkill,
): MockSkill[] | undefined {
  return singleSectionOf(start) ? undefined : [skill];
}

/** Section the runner should open for a start response, or null when unknown. */
export function targetSectionOf(start: MockStartResult, chosen?: MockSkill | null): MockSkill | null {
  const single = singleSectionOf(start);
  if (single) return single;
  const wanted = start.flowMode === 'full_test' ? start.currentSkill : (chosen ?? null);
  if (wanted && start.exam.sections.some((s) => s.skill === wanted)) return wanted;
  return start.exam.sections.length === 1 ? start.exam.sections[0].skill : null;
}

export interface MockSubmitResult {
  status: MockAttemptStatus;
  rawScores: Record<string, { score: number; max: number }>;
  sectionBands: Record<string, number> | null;
  overallBand: number | null;
  cefrLevel: string | null;
  specificationVersion?: string;
  scoreMethod?: 'ESTIMATED' | 'OFFICIAL_CALIBRATED' | null;
  scoreVersion?: string | null;
  overallScore?: number | null;
  standardScores?: Record<string, { estimatedStandardScore: number; isOfficial?: boolean }> | null;
}

/** Published + demo mocks visible to the signed-in student. Validated against the backend shape. */
export async function listMockExams(program?: ExamProgram, practiceLevel?: PracticeLevel): Promise<MockExamListItem[]> {
  const raw = await get<unknown>("/mock/exams", { program, practiceLevel });
  return parseOrThrow("GET /mock/exams", MockExamListSchema, raw);
}

export interface MockStartOptions {
  mode?: MockAttemptMode;
  flow?: 'single_skill' | 'full_test';
  /**
   * Single-section practice: the backend narrows the attempt scope to this
   * skill (attempt becomes `partial`, so the other sections are neither
   * downloaded nor required at submit time).
   */
  section?: MockSkill;
}

/**
 * Start (or resume) a mock attempt.
 *
 * Full mock sends `flow: 'full_test'` and nothing else. Single-section
 * practice sends the skill three ways — `section`, `section_filter` and
 * `skills` — because the backend accepts any of them and older deployments
 * read only one of these fields.
 */
export async function startMockExam(
  examId: string,
  opts?: MockStartOptions,
): Promise<MockStartResult> {
  const section = opts?.section;
  const payload: Record<string, unknown> = {
    mode: opts?.mode ?? "practice",
    flow: opts?.flow ?? 'single_skill',
  };
  if (section) {
    payload.section = section;
    payload.section_filter = section;
    payload.skills = [section];
  }
  const raw = await post<unknown>(`/mock/exams/${encodeURIComponent(examId)}/start`, payload);
  return parseOrThrow("POST /mock/exams/:id/start", MockStartResultSchema, raw);
}

export function saveMockAnswer(
  attemptId: string,
  questionId: string,
  response: string,
): Promise<{ saved: boolean }> {
  return post<{ saved: boolean }>(
    `/mock/attempts/${encodeURIComponent(attemptId)}/answer`,
    { questionId, response },
  );
}

export function bulkMockAnswers(
  attemptId: string,
  answers: Array<{ questionId: string; response: string }>,
): Promise<{ saved: number }> {
  return post<{ saved: number }>(
    `/mock/attempts/${encodeURIComponent(attemptId)}/answers`,
    { answers },
  );
}

/** Section-only submit: pass e.g. ["listening"] to grade just that section. */
export async function submitMockAttempt(
  attemptId: string,
  skills?: MockSkill[],
): Promise<MockSubmitResult> {
  const raw = await post<unknown>(
    `/mock/attempts/${encodeURIComponent(attemptId)}/submit`,
    skills && skills.length > 0 ? { skills } : {},
  );
  return parseOrThrow("POST /mock/attempts/:id/submit", MockSubmitResultSchema, raw);
}

/**
 * Upload a recorded speaking answer (multipart, <=25MB server-side).
 * Uses the shared API client for timeout handling and refresh on expired sessions.
 */
export async function uploadMockSpeaking(
  attemptId: string,
  questionId: string,
  blob: Blob,
  filename = blob.type.startsWith('audio/mp4') ? 'speaking.m4a' : 'speaking.webm',
): Promise<{ saved: boolean; audioUrl: string; audioDurationMs?: number }> {
  const form = new FormData();
  form.append("audio", blob, filename);
  return post<{ saved: boolean; audioUrl: string; audioDurationMs?: number }>(
    `/mock/attempts/${encodeURIComponent(attemptId)}/speaking/${encodeURIComponent(questionId)}`,
    form,
    { timeoutMs: 60_000 },
  );
}

export interface WritingOcrResponse {
  saved?: boolean;
  ocrText: string;
  imageUrls?: string[];
  pages?: Array<{ page: number; imageUrl?: string; text?: string }>;
  wordCount?: number;
}

export async function uploadMockWritingOcr(
  attemptId: string,
  questionId: string,
  files: File[],
): Promise<WritingOcrResponse> {
  const form = new FormData();
  for (const file of files) {
    form.append("images", file, file.name);
  }
  return post<WritingOcrResponse>(
    `/v1/mock/attempts/${encodeURIComponent(attemptId)}/writing/${encodeURIComponent(questionId)}/ocr`,
    form,
    { timeoutMs: 60_000 },
  );
}

export async function deleteMockExam(examId: string): Promise<void> {
  await del(`/v1/mock/exams/${encodeURIComponent(examId)}`);
}

/**
 * Turn the backend's sanitized media path into a fetchable absolute URL.
 * Same safety policy as tests.ts `resolveAudioUrl`: exact backend origin,
 * `/v1/` prefix stripped (API_BASE_URL already ends with /v1).
 */
export const resolveMockMediaUrl = resolveBackendMediaUrl;

/** Group audio URL with attemptId so the server counts timed replays. */
export function mockGroupAudioUrl(
  group: Pick<MockShapedGroup, "audioUrl">,
  attemptId: string,
  strict: boolean,
): string | null {
  const base = resolveMockMediaUrl(group.audioUrl);
  if (!base) return null;
  return strict ? `${base}?attemptId=${encodeURIComponent(attemptId)}` : base;
}

export const MOCK_SKILLS: MockSkill[] = ["listening", "reading", "writing", "speaking"];

export const MOCK_SKILL_LABEL: Record<MockSkill, string> = {
  listening: "Listening",
  reading: "Reading",
  writing: "Writing",
  speaking: "Speaking",
};

/** Approximate single-section practice durations shown on the start picker. */
export const MOCK_SECTION_MINUTES: Record<MockSkill, number> = {
  listening: 35,
  reading: 60,
  writing: 60,
  speaking: 15,
};

/** Section picker copy: emoji + short label for the single-section options. */
export const MOCK_SECTION_ICON: Record<MockSkill, string> = {
  listening: "🎧",
  reading: "📖",
  writing: "✍️",
  speaking: "🗣️",
};
