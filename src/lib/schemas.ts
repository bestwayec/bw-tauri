import { z } from "zod";
import type { ApiError } from "./api";

/**
 * Zod boundary validation for backend payloads.
 *
 * The backend (bestway monorepo) evolves independently of this client.
 * Every shaped response is checked here so drift fails LOUDLY (visible error
 * card with the offending path) instead of rendering garbage or crashing.
 *
 * Unknown keys are stripped (backend may add fields); missing/wrong-typed
 * keys throw a SCHEMA_MISMATCH ApiError.
 */

export function toSchemaError(scope: string, issues: z.ZodIssue[]): ApiError {
  const detail = issues
    .slice(0, 5)
    .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
    .join("; ");
  const more = issues.length > 5 ? ` (+${issues.length - 5} more)` : "";
  return {
    code: "SCHEMA_MISMATCH",
    message: `${scope} response did not match the expected shape: ${detail}${more}`,
    status: 200,
  };
}

export function parseOrThrow<T>(scope: string, schema: z.ZodType<T>, data: unknown): T {
  const parsed = schema.safeParse(data);
  if (!parsed.success) throw toSchemaError(scope, parsed.error.issues);
  return parsed.data;
}

// ---------------------------------------------------------------------------
// Shared primitives (mirror backend shape.ts / api-contract.md)
// ---------------------------------------------------------------------------

const nullableString = z.string().nullable();
const nullableNumber = z.number().nullable();

export const MockExamTypeSchema = z.enum(["ielts_academic", "ielts_general", "multilevel"]);
export const MockSkillSchema = z.enum(["listening", "reading", "writing", "speaking"]);
export const MockAccessSchema = z.enum(["granted", "pending", "locked"]);

export const MockProfileSchema = z
  .enum(["practice", "full_mock", "writing_speaking", "diagnostic", "section", "partial_practice", "single_skill"])
  .or(z.string())
  .catch("practice")
  .default("practice");

export const MockExamListItemSchema = z.object({
  id: z.string(),
  type: MockExamTypeSchema.catch("multilevel").default("multilevel"),
  profile: z.string().nullable().optional().catch("practice").default("practice").transform((v) => v || "practice"),
  rawProfile: z.string().nullable().optional().catch(null),
  track: z.string().nullable().optional().catch(null),
  status: z.string().nullable().optional().catch("published").default("published"),
  difficulty: z.string().nullable().optional().catch(null),
  target_level: z.string().nullable().optional().catch(null),
  title: z.string().catch("Mock Exam").default("Mock Exam"),
  description: nullableString.catch(null).default(null),
  level: nullableString.catch(null).default(null),
  practiceLevel: z.enum(['A1', 'A2', 'B1', 'B2', 'C1']).nullable().optional().catch(null),
  isDemo: z.boolean().catch(false).default(false),
  isPublished: z.boolean().catch(true).default(true),
  ready: z.boolean().optional().catch(true).default(true),
  skills: z.array(MockSkillSchema).catch([]).default([]),
  practiceSkills: z.array(MockSkillSchema).optional().catch([]),
  available_practice_skills: z.array(MockSkillSchema).optional().catch([]),
  practiceReady: z.boolean().optional().catch(true),
  is_practice_ready: z.boolean().optional().catch(true),
  questionCount: z.number().catch(0).default(0),
  durationMinutes: nullableNumber.catch(null).default(null),
  price: z.number().catch(0).default(0),
  access: MockAccessSchema.catch("granted").default("granted"),
});

export const MockExamListSchema = z.array(MockExamListItemSchema);

export const MockQuestionTypeSchema = z.enum([
  "multiple_choice",
  "multi_select",
  "true_false_notgiven",
  "yes_no_notgiven",
  "matching",
  "matching_headings",
  "sentence_completion",
  "note_completion",
  "summary_completion",
  "table_completion",
  "short_answer",
  "map_labelling",
  "essay_task1",
  "essay_task2",
  "speaking_task",
]);

export const MockShapedQuestionSchema = z.object({
  id: z.string(),
  number: z.number(),
  sortOrder: z.number(),
  type: MockQuestionTypeSchema,
  prompt: z.string(),
  options: z.array(z.string()).nullable(),
  points: z.number(),
  wordLimit: nullableNumber,
  answerRule: z.enum(['ONE_WORD', 'ONE_WORD_AND_OR_NUMBER']).nullable().optional(),
  guidance: z.object({ taskKey: z.string(), displayLabel: z.string().optional(), wordMin: z.number().optional(), wordMax: z.number().optional(), prepSeconds: z.number().optional(), responseSeconds: z.number().optional(), speakingProfileVersion: z.string().nullable().optional(), profileLabel: z.string().optional(), rawMax: z.number().optional() }).optional(),
});

export const MockShapedGroupSchema = z.object({
  id: z.string(),
  sortOrder: z.number(),
  title: nullableString,
  instructions: nullableString,
  passageText: nullableString,
  contentHtml: nullableString,
  contentLayout: nullableString,
  optionsReusable: z.boolean().nullable().optional(),
  hasAudio: z.boolean(),
  audioUrl: nullableString,
  imageUrl: nullableString,
  partNumber: nullableNumber,
  audioDurationSec: nullableNumber,
  audioStartSec: nullableNumber.optional(),
  stimulusRef: nullableString.optional(),
  audioPlayLimit: z.number(),
  questions: z.array(MockShapedQuestionSchema),
});

export const MockShapedSectionSchema = z.object({
  id: z.string(),
  skill: MockSkillSchema,
  title: nullableString,
  sortOrder: z.number(),
  durationMinutes: nullableNumber,
  instructions: nullableString,
  groups: z.array(MockShapedGroupSchema),
});

export const MockStartResultSchema = z.object({
  attemptId: z.string(),
  resumed: z.boolean(),
  mode: z.enum(["practice", "timed"]),
  simulatorMode: z.enum(["cdi", "dtm"]).nullable().optional(),
  startedAt: z.string(),
  deadlineAt: nullableString,
  serverTime: z.string(),
  durationMinutes: nullableNumber,
  flow: z.enum(["single_skill", "full_test"]).optional(),
  flowMode: z.enum(["single_skill", "full_test"]),
  currentSkill: MockSkillSchema.nullable(),
  sectionDeadlines: z.record(z.string(), z.string()).nullable(),
  overallDeadlineAt: nullableString,
  exam: z.object({
    id: z.string(),
    type: MockExamTypeSchema,
    specificationVersion: z.string().optional(),
    speakingProfileVersion: z.string().nullable().optional(),
    speakingProfile: z.object({ version: z.string(), isOfficialTiming: z.boolean(), parts: z.array(z.object({ key: z.string(), prepSeconds: z.array(z.number().nonnegative()), responseSeconds: z.array(z.number().positive()) })) }).optional(),
    title: z.string(),
    description: nullableString,
    level: nullableString,
    practiceLevel: z.enum(['A1', 'A2', 'B1', 'B2', 'C1']).nullable().optional().catch(null),
    isPublished: z.boolean(),
    isDemo: z.boolean(),
    createdAt: z.string(),
    updatedAt: z.string(),
    questionCount: z.number(),
    sections: z.array(MockShapedSectionSchema),
  }),
  annotations: z.array(z.unknown()),
  savedAnswers: z.record(z.string(), z.string()),
  // Single-section practice scope (server-authoritative).
  isSingleSection: z.boolean().optional(),
  singleSection: MockSkillSchema.nullable().optional(),
  attemptTypeLabel: z.string().optional(),
});

export const MockSubmitResultSchema = z.object({
  status: z.enum(["in_progress", "grading", "completed"]),
  rawScores: z.record(z.string(), z.object({ score: z.number(), max: z.number() })),
  sectionBands: z.record(z.string(), z.number()).nullable(),
  overallBand: nullableNumber,
  cefrLevel: nullableString,
  specificationVersion: z.string().optional(),
  scoreMethod: z.enum(['ESTIMATED','OFFICIAL_CALIBRATED']).nullable().optional(),
  scoreVersion: z.string().nullable().optional(),
  overallScore: z.number().nullable().optional(),
  standardScores: z.record(z.string(), z.object({ estimatedStandardScore: z.number(), isOfficial: z.boolean().optional() })).nullable().optional(),
});

// ---------------------------------------------------------------------------
// Legacy tests API (backend/src/tests)
// ---------------------------------------------------------------------------

export const TestListItemSchema = z.object({
  id: z.string(),
  type: z.string().catch("multilevel").default("multilevel"),
  track: z.string().nullable().optional().catch(null),
  status: z.string().nullable().optional().catch("published").default("published"),
  difficulty: z.string().nullable().optional().catch(null),
  target_level: z.string().nullable().optional().catch(null),
  title: z.string().catch("Practice Test").default("Practice Test"),
  level: nullableString.catch(null).default(null),
  practiceLevel: z.enum(['A1', 'A2', 'B1', 'B2', 'C1']).nullable().optional().catch(null),
  isDemo: z.boolean().catch(false).default(false),
  isActive: z.boolean().catch(true).default(true),
  durationMinutes: nullableNumber.catch(null).default(null),
  questionCount: z.number().catch(0).default(0),
  sections: z.array(z.enum(["listening", "reading", "writing", "speaking"])).catch([]).default([]),
});

export const TestListSchema = z.array(TestListItemSchema);
