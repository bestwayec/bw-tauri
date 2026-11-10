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
  profile?: string | null;
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
  practiceSkills?: MockSkill[];
  available_practice_skills?: MockSkill[];
  practiceReady?: boolean;
  is_practice_ready?: boolean;
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
  sessionSignature?: string;
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
/** Fetches full dynamic Computer-Delivered (CD) exam session payload. */
export async function fetchCdExamSession(examId: string): Promise<any> {
  const res = await get<{ data?: any }>(`/api/v1/exams/${encodeURIComponent(examId)}/cd-session/`);
  return (res as any)?.data ?? res;
}

export async function listMockExams(program?: ExamProgram, practiceLevel?: PracticeLevel): Promise<MockExamListItem[]> {
  const raw = await get<unknown>("/mock/exams", { program, practiceLevel });
  try {
    return parseOrThrow("GET /mock/exams", MockExamListSchema, raw);
  } catch {
    if (!Array.isArray(raw)) return [];
    return raw
      .filter(
        (item): item is Record<string, unknown> =>
          typeof item === "object" && item !== null && typeof (item as { id?: unknown }).id === "string",
      )
      .map((item) => ({
        id: String(item.id),
        type:
          item.type === "ielts_academic" || item.type === "ielts_general" || item.type === "multilevel"
            ? item.type
            : "multilevel",
        profile: typeof item.profile === "string" && item.profile ? item.profile : "practice",
        title: typeof item.title === "string" && item.title ? item.title : "Mock Exam",
        description: typeof item.description === "string" ? item.description : null,
        level: typeof item.level === "string" ? item.level : null,
        practiceLevel:
          item.practiceLevel === "A1" ||
          item.practiceLevel === "A2" ||
          item.practiceLevel === "B1" ||
          item.practiceLevel === "B2" ||
          item.practiceLevel === "C1"
            ? item.practiceLevel
            : null,
        isDemo: Boolean(item.isDemo),
        isPublished: item.isPublished !== false,
        ready: item.ready !== false,
        skills: Array.isArray(item.skills)
          ? (item.skills.filter(
              (s): s is MockSkill =>
                s === "listening" || s === "reading" || s === "writing" || s === "speaking",
            ) as MockSkill[])
          : [],
        questionCount: typeof item.questionCount === "number" ? item.questionCount : 0,
        durationMinutes: typeof item.durationMinutes === "number" ? item.durationMinutes : null,
        price: typeof item.price === "number" ? item.price : 0,
        access:
          item.access === "granted" || item.access === "pending" || item.access === "locked"
            ? item.access
            : "granted",
      }));
  }
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
export function normalizeMockSkill(raw: unknown): MockSkill {
  if (typeof raw === "string") {
    const s = raw.toLowerCase().trim();
    if (s.includes("listen")) return "listening";
    if (s.includes("read")) return "reading";
    if (s.includes("writ")) return "writing";
    if (s.includes("speak")) return "speaking";
  }
  return "reading";
}

export function normalizeQuestionType(t: string | undefined | null): MockQuestionType {
  const s = String(t ?? "").toLowerCase().trim();
  switch (s) {
    case "single_choice":
    case "multiple_choice":
    case "mcq":
      return "multiple_choice";
    case "multi_select":
    case "multiselect":
    case "multi-select":
      return "multi_select";
    case "true_false_notgiven":
    case "true_false_ng":
    case "true_false":
    case "tfng":
      return "true_false_notgiven";
    case "yes_no_notgiven":
    case "yes_no_ng":
    case "ynng":
      return "yes_no_notgiven";
    case "matching":
    case "speaker_matching":
    case "matching_statements":
      return "matching";
    case "matching_headings":
      return "matching_headings";
    case "map_labelling":
    case "map_labeling":
    case "map_dropdown":
    case "map_matching":
    case "map_label":
      return "map_labelling";
    case "sentence_completion":
    case "gap_fill":
    case "in_text_blank":
    case "completion":
      return "sentence_completion";
    case "note_completion":
      return "note_completion";
    case "summary_completion":
      return "summary_completion";
    case "table_completion":
      return "table_completion";
    case "short_answer":
      return "short_answer";
    case "essay_task1":
    case "essay":
      return "essay_task1";
    case "essay_task2":
      return "essay_task2";
    case "speaking":
    case "speaking_task":
    case "speaking_prompt":
      return "speaking_task";
    default:
      if (s.includes("map")) return "map_labelling";
      if (s.includes("match")) return "matching";
      if (s.includes("sentence")) return "sentence_completion";
      if (s.includes("summary")) return "summary_completion";
      if (s.includes("note")) return "note_completion";
      if (s.includes("table")) return "table_completion";
      if (s.includes("choice")) return "multiple_choice";
      if (s.includes("essay")) return "essay_task1";
      if (s.includes("speak")) return "speaking_task";
      return "short_answer";
  }
}

export function normalizeMockQuestion(q: any, idx: number): MockShapedQuestion {
  const rawType = q.type ?? q.question_type ?? q.questionType ?? "multiple_choice";
  const num = typeof q.number === "number" ? q.number : typeof q.question_number === "number" ? q.question_number : (idx + 1);
  const sort = typeof q.sortOrder === "number" ? q.sortOrder : typeof q.sort_order === "number" ? q.sort_order : typeof q.order === "number" ? q.order : idx;
  const pts = typeof q.points === "number" ? q.points : typeof q.maxScore === "number" ? q.maxScore : typeof q.max_score === "number" ? q.max_score : 1;
  const wordLimit = typeof q.wordLimit === "number" ? q.wordLimit : typeof q.word_limit === "number" ? q.word_limit : null;
  const answerRule = q.answerRule ?? q.answer_rule ?? null;

  let options: string[] | null = null;
  const rawOpts = q.options ?? q.payload?.options ?? null;
  if (Array.isArray(rawOpts)) {
    options = rawOpts.map((opt) => {
      if (typeof opt === "string") return opt;
      if (typeof opt === "object" && opt !== null) {
        return (opt as any).text ?? (opt as any).label ?? (opt as any).value ?? JSON.stringify(opt);
      }
      return String(opt);
    });
  } else if (rawOpts && typeof rawOpts === "object") {
    options = Object.values(rawOpts).map((v) => (typeof v === "string" ? v : String(v)));
  }

  return {
    id: String(q.id ?? q._id ?? q.question_id ?? `q-${num}-${idx}`),
    number: num,
    sortOrder: sort,
    type: normalizeQuestionType(rawType),
    prompt: String(q.prompt ?? q.text ?? q.question ?? ""),
    options,
    points: pts,
    wordLimit,
    answerRule: answerRule === "ONE_WORD" || answerRule === "ONE_WORD_AND_OR_NUMBER" ? answerRule : null,
    guidance: q.guidance,
  };
}

export function normalizeMockSection(rawSection: any, sectionIdx = 0): MockShapedSection {
  if (!rawSection || typeof rawSection !== "object") {
    return {
      id: `sec-${sectionIdx}`,
      skill: "reading",
      title: "Reading",
      sortOrder: sectionIdx,
      durationMinutes: null,
      instructions: null,
      groups: [],
    };
  }

  const skill = normalizeMockSkill(
    rawSection.skill ?? rawSection.section_type ?? rawSection.sectionType ?? rawSection.type ?? rawSection.name
  );

  const rawGroups: any[] = Array.isArray(rawSection.groups)
    ? rawSection.groups
    : Array.isArray(rawSection.question_groups)
    ? rawSection.question_groups
    : Array.isArray(rawSection.questionGroups)
    ? rawSection.questionGroups
    : Array.isArray(rawSection.parts)
    ? rawSection.parts
    : [];

  const rawFlatQuestions: any[] = Array.isArray(rawSection.questions)
    ? rawSection.questions
    : Array.isArray(rawSection.question_list)
    ? rawSection.question_list
    : Array.isArray(rawSection.items)
    ? rawSection.items
    : [];

  let groupList: any[] = [...rawGroups];

  if (groupList.length === 0 && rawFlatQuestions.length > 0) {
    const partKeys = new Set<string | number>();
    rawFlatQuestions.forEach((q) => {
      const p = q.part_number ?? q.partNumber ?? q.part ?? q.group_id ?? q.groupId ?? q.question_group_id;
      if (p != null) partKeys.add(p);
    });

    if (partKeys.size > 1) {
      const sortedKeys = Array.from(partKeys);
      groupList = sortedKeys.map((key, ki) => ({
        id: `group-${key}`,
        sortOrder: ki,
        partNumber: ki + 1,
        title: skill === "reading" ? `Passage ${ki + 1}` : `Part ${ki + 1}`,
        instructions: null,
        passageText: null,
        contentHtml: null,
        contentLayout: null,
        hasAudio: skill === "listening",
        audioUrl: null,
        imageUrl: null,
        audioDurationSec: null,
        audioPlayLimit: 1,
        questions: rawFlatQuestions.filter((q) => {
          const p = q.part_number ?? q.partNumber ?? q.part ?? q.group_id ?? q.groupId ?? q.question_group_id;
          return p === key;
        }),
      }));
    } else if (skill === "listening" && rawFlatQuestions.length === 35) {
      // Standard Multilevel Listening: 6 parts [8, 6, 6, 6, 4, 5]
      const counts = [8, 6, 6, 6, 4, 5];
      let offset = 0;
      groupList = counts.map((count, pi) => {
        const slice = rawFlatQuestions.slice(offset, offset + count);
        offset += count;
        return {
          id: `group-part-${pi + 1}`,
          sortOrder: pi,
          partNumber: pi + 1,
          title: `Part ${pi + 1}`,
          instructions: null,
          passageText: null,
          contentHtml: null,
          contentLayout: pi === 3 ? "map_matching" : null,
          hasAudio: true,
          audioUrl: null,
          imageUrl: null,
          audioDurationSec: null,
          audioPlayLimit: 1,
          questions: slice,
        };
      });
    } else if (skill === "reading" && rawFlatQuestions.length === 35) {
      // Standard Multilevel Reading: 5 parts [6, 8, 6, 8, 7]
      const counts = [6, 8, 6, 8, 7];
      let offset = 0;
      groupList = counts.map((count, pi) => {
        const slice = rawFlatQuestions.slice(offset, offset + count);
        offset += count;
        return {
          id: `group-part-${pi + 1}`,
          sortOrder: pi,
          partNumber: pi + 1,
          title: `Passage ${pi + 1}`,
          instructions: null,
          passageText: null,
          contentHtml: null,
          contentLayout: null,
          hasAudio: false,
          audioUrl: null,
          imageUrl: null,
          audioDurationSec: null,
          audioPlayLimit: 1,
          questions: slice,
        };
      });
    } else {
      groupList = [
        {
          id: `group-1`,
          sortOrder: 0,
          partNumber: 1,
          title: skill === "reading" ? "Passage 1" : "Part 1",
          instructions: rawSection.instructions ?? null,
          passageText: rawSection.passageText ?? rawSection.passage_text ?? null,
          contentHtml: rawSection.contentHtml ?? rawSection.content_html ?? null,
          contentLayout: null,
          hasAudio: skill === "listening",
          audioUrl: rawSection.audioUrl ?? rawSection.audio_url ?? null,
          imageUrl: rawSection.imageUrl ?? rawSection.image_url ?? null,
          audioDurationSec: null,
          audioPlayLimit: 1,
          questions: rawFlatQuestions,
        },
      ];
    }
  }

  const totalGroupQuestions = groupList.reduce(
    (acc, g) => acc + (Array.isArray(g.questions) ? g.questions.length : Array.isArray(g.question_list) ? g.question_list.length : 0),
    0
  );

  if (totalGroupQuestions === 0 && rawFlatQuestions.length > 0) {
    let anyMatched = false;
    groupList.forEach((g, gi) => {
      const gid = g.id ?? g._id ?? g.key;
      const pNum = g.partNumber ?? g.part_number ?? (gi + 1);
      const matched = rawFlatQuestions.filter((q) => {
        const qGid = q.group_id ?? q.groupId ?? q.question_group_id;
        const qPart = q.part_number ?? q.partNumber ?? q.part;
        return (qGid != null && String(qGid) === String(gid)) || (qPart != null && Number(qPart) === Number(pNum));
      });
      if (matched.length > 0) {
        g.questions = matched;
        anyMatched = true;
      }
    });

    if (!anyMatched) {
      if (skill === "listening" && groupList.length === 6 && rawFlatQuestions.length === 35) {
        const counts = [8, 6, 6, 6, 4, 5];
        let offset = 0;
        groupList.forEach((g, pi) => {
          const count = counts[pi] ?? 6;
          g.questions = rawFlatQuestions.slice(offset, offset + count);
          offset += count;
        });
      } else if (skill === "reading" && groupList.length === 5 && rawFlatQuestions.length === 35) {
        const counts = [6, 8, 6, 8, 7];
        let offset = 0;
        groupList.forEach((g, pi) => {
          const count = counts[pi] ?? 7;
          g.questions = rawFlatQuestions.slice(offset, offset + count);
          offset += count;
        });
      } else {
        const perGroup = Math.ceil(rawFlatQuestions.length / (groupList.length || 1));
        groupList.forEach((g, gi) => {
          g.questions = rawFlatQuestions.slice(gi * perGroup, (gi + 1) * perGroup);
        });
      }
    }
  }

  let globalQNum = 0;
  const groups: MockShapedGroup[] = groupList
    .sort((a, b) => (a.sortOrder ?? a.sort_order ?? a.order ?? 0) - (b.sortOrder ?? b.sort_order ?? b.order ?? 0))
    .map((g, gi) => {
      const gQuestionsRaw: any[] = Array.isArray(g.questions)
        ? g.questions
        : Array.isArray(g.question_list)
        ? g.question_list
        : Array.isArray(g.items)
        ? g.items
        : [];

      const questions: MockShapedQuestion[] = gQuestionsRaw
        .sort(
          (a, b) =>
            (a.sortOrder ?? a.sort_order ?? a.order ?? 0) - (b.sortOrder ?? b.sort_order ?? b.order ?? 0) ||
            (a.number ?? a.question_number ?? 0) - (b.number ?? b.question_number ?? 0)
        )
        .map((q, qi) => {
          globalQNum++;
          const nq = normalizeMockQuestion(q, qi);
          if (typeof q.number !== "number" && typeof q.question_number !== "number") {
            nq.number = globalQNum;
          }
          return nq;
        });

      const audioUrl = g.audioUrl ?? g.audio_url ?? g.audio ?? null;
      const imageUrl = g.imageUrl ?? g.image_url ?? g.image ?? null;
      const hasAudio = Boolean(g.hasAudio ?? g.has_audio ?? audioUrl);

      return {
        id: String(g.id ?? g._id ?? g.key ?? `group-${gi + 1}`),
        sortOrder: typeof g.sortOrder === "number" ? g.sortOrder : typeof g.sort_order === "number" ? g.sort_order : gi,
        title: g.title ?? null,
        instructions: g.instructions ?? null,
        passageText: g.passageText ?? g.passage_text ?? g.text ?? null,
        contentHtml: g.contentHtml ?? g.content_html ?? null,
        contentLayout: g.contentLayout ?? g.content_layout ?? null,
        optionsReusable: g.optionsReusable ?? g.options_reusable ?? null,
        hasAudio,
        audioUrl,
        imageUrl,
        partNumber: typeof g.partNumber === "number" ? g.partNumber : typeof g.part_number === "number" ? g.part_number : (gi + 1),
        audioDurationSec: typeof g.audioDurationSec === "number" ? g.audioDurationSec : typeof g.audio_duration_sec === "number" ? g.audio_duration_sec : null,
        audioStartSec: typeof g.audioStartSec === "number" ? g.audioStartSec : typeof g.audio_start_sec === "number" ? g.audio_start_sec : null,
        stimulusRef: typeof g.stimulusRef === "string" ? g.stimulusRef : typeof g.stimulus_ref === "string" ? g.stimulus_ref : null,
        audioPlayLimit: typeof g.audioPlayLimit === "number" ? g.audioPlayLimit : typeof g.audio_play_limit === "number" ? g.audio_play_limit : 1,
        questions,
      };
    });

  return {
    id: String(rawSection.id ?? rawSection._id ?? `sec-${skill}`),
    skill,
    title: rawSection.title ?? (skill === "listening" ? "Listening" : skill === "reading" ? "Reading" : skill === "writing" ? "Writing" : "Speaking"),
    sortOrder: typeof rawSection.sortOrder === "number" ? rawSection.sortOrder : typeof rawSection.sort_order === "number" ? rawSection.sort_order : sectionIdx,
    durationMinutes: typeof rawSection.durationMinutes === "number" ? rawSection.durationMinutes : typeof rawSection.duration_minutes === "number" ? rawSection.duration_minutes : null,
    instructions: rawSection.instructions ?? null,
    groups,
  };
}

export function normalizeMockStartResult(raw: any): MockStartResult {
  if (!raw || typeof raw !== "object") return raw;
  const data = raw.data ?? raw;
  const examRaw = data.exam ?? {};
  const rawSections: any[] = Array.isArray(examRaw.sections) ? examRaw.sections : [];

  const sections = rawSections.map((s, idx) => normalizeMockSection(s, idx));
  const questionCount = sections.reduce(
    (sum, s) => sum + s.groups.reduce((gSum, g) => gSum + g.questions.length, 0),
    0
  );

  const currentSkill = data.currentSkill ?? data.current_skill ?? (sections[0]?.skill ?? null);

  return {
    attemptId: String(data.attemptId ?? data.attempt_id ?? data.id ?? ""),
    sessionSignature: data.sessionSignature ?? data.session_signature,
    resumed: Boolean(data.resumed),
    mode: data.mode === "timed" ? "timed" : "practice",
    simulatorMode: data.simulatorMode ?? data.simulator_mode ?? null,
    startedAt: String(data.startedAt ?? data.started_at ?? new Date().toISOString()),
    deadlineAt: data.deadlineAt ?? data.deadline_at ?? null,
    serverTime: String(data.serverTime ?? data.server_time ?? new Date().toISOString()),
    durationMinutes: typeof data.durationMinutes === "number" ? data.durationMinutes : typeof data.duration_minutes === "number" ? data.duration_minutes : null,
    flowMode: data.flowMode ?? data.flow_mode ?? data.flow ?? "single_skill",
    currentSkill: currentSkill ? normalizeMockSkill(currentSkill) : null,
    sectionDeadlines: data.sectionDeadlines ?? data.section_deadlines ?? null,
    overallDeadlineAt: data.overallDeadlineAt ?? data.overall_deadline_at ?? null,
    exam: {
      id: String(examRaw.id ?? examRaw._id ?? ""),
      type: examRaw.type === "ielts_academic" || examRaw.type === "ielts_general" || examRaw.type === "multilevel" ? examRaw.type : "multilevel",
      specificationVersion: examRaw.specificationVersion ?? examRaw.specification_version,
      speakingProfileVersion: examRaw.speakingProfileVersion ?? examRaw.speaking_profile_version ?? null,
      speakingProfile: examRaw.speakingProfile ?? examRaw.speaking_profile,
      title: String(examRaw.title ?? "Mock Exam"),
      description: examRaw.description ?? null,
      level: examRaw.level ?? null,
      practiceLevel: examRaw.practiceLevel ?? examRaw.practice_level ?? null,
      isPublished: examRaw.isPublished !== false && examRaw.is_published !== false,
      isDemo: Boolean(examRaw.isDemo ?? examRaw.is_demo),
      createdAt: String(examRaw.createdAt ?? examRaw.created_at ?? new Date().toISOString()),
      updatedAt: String(examRaw.updatedAt ?? examRaw.updated_at ?? new Date().toISOString()),
      questionCount: examRaw.questionCount ?? examRaw.question_count ?? questionCount,
      sections,
    },
    annotations: Array.isArray(data.annotations) ? data.annotations : [],
    savedAnswers: data.savedAnswers ?? data.saved_answers ?? {},
    isSingleSection: data.isSingleSection ?? data.is_single_section,
    singleSection: data.singleSection ? normalizeMockSkill(data.singleSection) : (data.single_section ? normalizeMockSkill(data.single_section) : undefined),
    attemptTypeLabel: data.attemptTypeLabel ?? data.attempt_type_label,
  };
}

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
  const normalized = normalizeMockStartResult(raw);
  return parseOrThrow("POST /mock/exams/:id/start", MockStartResultSchema, normalized);
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
  const receipt = await post<{ saved: boolean; audioUrl: string; audioDurationMs?: number }>(
    `/mock/attempts/${encodeURIComponent(attemptId)}/speaking/${encodeURIComponent(questionId)}`,
    form,
    { timeoutMs: 60_000 },
  );
  if (receipt?.saved !== true || typeof receipt.audioUrl !== 'string' || !receipt.audioUrl.trim()) {
    throw { code: 'SCHEMA_MISMATCH', message: 'The server did not confirm the recording was saved.', status: 502 };
  }
  return receipt;
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
