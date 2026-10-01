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

export const MockExamListItemSchema = z.object({
  id: z.string(),
  type: MockExamTypeSchema,
  title: z.string(),
  description: nullableString,
  level: nullableString,
  isDemo: z.boolean(),
  isPublished: z.boolean(),
  skills: z.array(MockSkillSchema),
  questionCount: z.number(),
  durationMinutes: nullableNumber,
  price: z.number(),
  access: MockAccessSchema,
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
});

export const MockShapedGroupSchema = z.object({
  id: z.string(),
  sortOrder: z.number(),
  title: nullableString,
  instructions: nullableString,
  passageText: nullableString,
  contentHtml: nullableString,
  contentLayout: nullableString,
  hasAudio: z.boolean(),
  audioUrl: nullableString,
  imageUrl: nullableString,
  partNumber: nullableNumber,
  audioDurationSec: nullableNumber,
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
    title: z.string(),
    description: nullableString,
    level: nullableString,
    isPublished: z.boolean(),
    isDemo: z.boolean(),
    createdAt: z.string(),
    updatedAt: z.string(),
    questionCount: z.number(),
    sections: z.array(MockShapedSectionSchema),
  }),
  annotations: z.array(z.unknown()),
  savedAnswers: z.record(z.string(), z.string()),
});

export const MockSubmitResultSchema = z.object({
  status: z.enum(["in_progress", "grading", "completed"]),
  rawScores: z.record(z.string(), z.object({ score: z.number(), max: z.number() })),
  sectionBands: z.record(z.string(), z.number()).nullable(),
  overallBand: nullableNumber,
  cefrLevel: nullableString,
});

// ---------------------------------------------------------------------------
// Legacy tests API (backend/src/tests)
// ---------------------------------------------------------------------------

export const TestListItemSchema = z.object({
  id: z.string(),
  type: z.string(),
  title: z.string(),
  level: nullableString,
  isDemo: z.boolean(),
  isActive: z.boolean(),
  durationMinutes: nullableNumber,
  questionCount: z.number(),
  sections: z.array(z.enum(["listening", "reading", "writing", "speaking"])),
});

export const TestListSchema = z.array(TestListItemSchema);
