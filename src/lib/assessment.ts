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

/** Score headline for one graded skill, or null while nothing is graded yet. */
export function feedbackScoreLabel(assessment: Assessment): string | null {
  const score = assessment.finalScore ?? assessment.aiScore;
  if (score === null || score === undefined) return null;
  const skill = assessment.skill === 'writing' ? 'Writing' : 'Speaking';
  return assessment.program === 'MULTILEVEL'
    ? `Estimated Multilevel ${skill} score ${score} out of 75`
    : `Estimated IELTS ${skill} band ${score}`;
}

/** Where an attempt's AI work stands, from the student's point of view. */
export type AssessmentPhase = 'none' | 'processing' | 'ready' | 'review' | 'failed';

/**
 * Progress beats completion: while any job is still running the student keeps
 * watching that job, even when a sibling skill already finished.
 */
export function assessmentPhase(data: AssessmentAttempt | undefined): AssessmentPhase {
  const jobs = data?.assessments ?? [];
  if (jobs.length === 0) return 'none';
  if (jobs.some((job) => job.status === 'PENDING' || job.status === 'PROCESSING' || job.status === 'RETRY')) return 'processing';
  if (jobs.some((job) => job.status === 'SUCCEEDED')) return 'ready';
  if (jobs.some((job) => job.status === 'FAILED')) return 'failed';
  return 'review';
}

/** What the student is told while the AI works, and once it has finished. */
export function assessmentPhaseLabel(phase: AssessmentPhase, skill: string): string {
  switch (phase) {
    case 'processing': return `AI is analysing your ${skill} — feedback appears below automatically.`;
    case 'ready': return `AI feedback for your ${skill} is ready — read it below.`;
    case 'review': return `Your ${skill} needs teacher review — the AI estimate is shown below.`;
    case 'failed': return `AI assessment for your ${skill} could not complete — a teacher will grade it.`;
    case 'none': return `Your ${skill} answers are saved. Feedback appears here once assessment starts.`;
  }
}

/** Join short phrases into one spoken sentence, dropping empties. */
function sentenceList(items: string[]): string | null {
  const cleaned = items.map((item) => item.trim().replace(/[.\s]+$/, '')).filter(Boolean);
  return cleaned.length > 0 ? cleaned.join('. ') : null;
}

/**
 * Spoken version of the written feedback: score, status, strengths, priority
 * improvements, up to three corrections and the recommended practice. The
 * original answer is deliberately not read back — the student has just written
 * it, and a full essay read aloud would bury the advice.
 */
export function feedbackSpeechText(assessment: Assessment): string | null {
  const result = assessment.approvedFeedback ?? assessment.evaluation?.result;
  if (!result) return null;
  const sentences: string[] = [];
  const score = feedbackScoreLabel(assessment);
  if (score) sentences.push(`${score}.`);
  sentences.push(`${assessmentStatus(assessment)}.`);
  // The written card marks the same distinction; spoken feedback must not blur
  // a teacher-approved result into an AI estimate.
  sentences.push(assessment.approvedFeedback ? 'This feedback was approved by your teacher.' : 'This is an AI estimate.');
  const sections: Array<[string, string[]]> = [
    ['Strengths', result.overallStrengths],
    ['Priority improvements', result.priorityImprovements],
    ['Grammar', result.grammarCorrections.slice(0, 3).map((correction) => `say ${correction.corrected} instead of ${correction.original}`)],
    ['Vocabulary', result.vocabularyUpgrades.slice(0, 3).map((upgrade) => `replace ${upgrade.original} with ${upgrade.alternative}`)],
    ['Recommended next practice', result.recommendedPractice],
  ];
  for (const [label, items] of sections) {
    const joined = sentenceList(items);
    if (joined) sentences.push(`${label}: ${joined}.`);
  }
  return sentences.join(' ');
}

/** Speech synthesis is missing on some platforms: feedback degrades to the card. */
export function speechFeedbackSupported(): boolean {
  return typeof window !== 'undefined' && 'speechSynthesis' in window && typeof window.SpeechSynthesisUtterance === 'function';
}

/**
 * Read feedback aloud. False means speech synthesis is unavailable, so the
 * written card stays the one source of feedback.
 */
export function speakFeedback(text: string, onEnd?: () => void): boolean {
  if (!text || !speechFeedbackSupported()) return false;
  try {
    const synth = window.speechSynthesis;
    synth.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.rate = 0.98;
    utterance.onend = () => onEnd?.();
    utterance.onerror = () => onEnd?.();
    synth.speak(utterance);
    return true;
  } catch {
    return false;
  }
}

/** Stop any feedback being read (leaving the page, starting another card). */
export function stopFeedbackSpeech(): void {
  if (!speechFeedbackSupported()) return;
  try {
    window.speechSynthesis.cancel();
  } catch {
    /* nothing to stop */
  }
}
