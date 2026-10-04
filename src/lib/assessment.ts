import { z } from 'zod';
import { get } from './api';
import { parseOrThrow } from './schemas';

const nullableScore = z.number().finite().nullable();
const pronunciation = z.enum(['UNAVAILABLE', 'ACOUSTIC']);
const feedbackSchema = z.object({
  taskCoverage: z.string(), grammar: z.string(), vocabulary: z.string(),
  fluencyCohesion: z.string(), ideaDevelopment: z.string(), register: z.string(),
  spellingPunctuation: z.string(), strengths: z.array(z.string()), issues: z.array(z.string()),
  missedPrompts: z.array(z.string()), usefulPhrases: z.array(z.string()),
  forCovered: z.boolean().nullable(), againstCovered: z.boolean().nullable(),
  position: z.string(), argumentBalance: z.string(),
});
export const assessmentResultSchema = z.object({
  parts: z.array(z.object({ id: z.string(), rawScore: nullableScore,
    criteria: z.record(z.string(), nullableScore), evidence: z.record(z.string(), z.string()), feedback: feedbackSchema })),
  overallStrengths: z.array(z.string()), priorityImprovements: z.array(z.string()),
  grammarCorrections: z.array(z.object({ original: z.string(), corrected: z.string(), explanation: z.string() })),
  vocabularyUpgrades: z.array(z.object({ original: z.string(), alternative: z.string(), explanation: z.string() })),
  improvedExamples: z.array(z.object({ partId: z.string(), text: z.string() })),
  recommendedPractice: z.array(z.string()), confidence: z.number().min(0).max(1), pronunciationEvidence: pronunciation,
});
export const assessmentAttemptSchema = z.object({
  attemptId: z.string(), assessments: z.array(z.object({
    id: z.string(), skill: z.enum(['writing', 'speaking']),
    program: z.enum(['IELTS_ACADEMIC', 'IELTS_GENERAL', 'MULTILEVEL']),
    status: z.enum(['PENDING', 'PROCESSING', 'SUCCEEDED', 'RETRY', 'FAILED', 'NEEDS_REVIEW']),
    policyMode: z.enum(['PRACTICE_AUTO_AI', 'FULL_MOCK_AI_WITH_REVIEW', 'MANUAL_ONLY']), version: z.number().int().positive(),
    aiScore: nullableScore, teacherScore: nullableScore, finalScore: nullableScore,
    finalScoreSource: z.enum(['AI', 'TEACHER', 'ADJUDICATED']).nullable(), confidence: z.number().min(0).max(1).nullable(),
    rubricVersion: z.string(), promptVersion: z.string(),
    evaluation: z.object({ result: assessmentResultSchema }).nullable(), approvedFeedback: assessmentResultSchema.nullable(),
    submissions: z.array(z.object({ questionId: z.string(), partId: z.string(), prompt: z.string(), context: z.string(),
      originalResponse: z.string(), wordCount: z.number().int().nonnegative(), audioUrl: z.string().nullable(),
      transcript: z.object({ text: z.string(), confidence: z.number().min(0).max(1).nullable(),
        segments: z.array(z.object({ start: z.number().nonnegative(), end: z.number().nonnegative(), text: z.string(), confidence: z.number().min(0).max(1).nullable() })),
        pronunciationEvidence: pronunciation }).nullable(),
    })),
    parts: z.array(z.object({ id: z.string(), max: z.number().positive(), task: z.string(), context: z.string() })),
  })),
});
export type AssessmentAttempt = z.infer<typeof assessmentAttemptSchema>;
export type Assessment = AssessmentAttempt['assessments'][number];
export type AssessmentResult = z.infer<typeof assessmentResultSchema>;

export async function getAssessment(attemptId: string): Promise<AssessmentAttempt> {
  return parseOrThrow('GET assessment', assessmentAttemptSchema,
    await get<unknown>(`/assessment/attempts/${encodeURIComponent(attemptId)}`));
}

export const ASSESSMENT_POLL_INTERVAL = 15_000;
export const ASSESSMENT_POLL_LIMIT = 20;
export const ASSESSMENT_POLL_WINDOW = 5 * 60_000;
export function shouldPollAssessment(data: AssessmentAttempt | undefined, completedPolls: number, elapsedMs: number) {
  return completedPolls < ASSESSMENT_POLL_LIMIT && elapsedMs < ASSESSMENT_POLL_WINDOW &&
    !!data?.assessments.some((assessment) => ['PENDING', 'PROCESSING', 'RETRY'].includes(assessment.status));
}
export function assessmentStatus(assessment: Assessment): string {
  if (assessment.finalScoreSource === 'TEACHER' || assessment.teacherScore !== null) return 'Teacher reviewed';
  const labels = { PENDING: 'Queued', PROCESSING: 'Processing', RETRY: 'Queued for retry',
    SUCCEEDED: assessment.finalScore === null ? 'AI graded · teacher confirmation required' : 'AI graded',
    NEEDS_REVIEW: 'Teacher review required', FAILED: 'Failed — manual review pending' };
  return labels[assessment.status];
}
