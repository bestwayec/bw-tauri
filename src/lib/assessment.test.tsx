import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { assessmentAttemptSchema, assessmentPhase, assessmentPhaseLabel, assessmentStatus, feedbackSpeechText, getAssessment, shouldPollAssessment, speakFeedback, speechFeedbackSupported, stopFeedbackSpeech, type Assessment } from './assessment';
import { AssessmentCard, AiAssessmentBanner } from '@/components/assessment/AssessmentFeedback';
import { get } from './api';

vi.mock('./api', () => ({ get: vi.fn(), API_BASE_URL: 'https://api.example.test/v1' }));

const feedback = { taskCoverage: 'Both sides addressed', grammar: 'Clear grammar', vocabulary: 'Appropriate words', fluencyCohesion: 'Connected response',
  ideaDevelopment: 'Reasons included', register: '', spellingPunctuation: '', strengths: ['Examples'], issues: ['Develop ideas'], missedPrompts: [], usefulPhrases: ['On the other hand'],
  forCovered: true, againstCovered: false, position: 'A balanced position', argumentBalance: 'Develop the opposing side' };
function fixture(status: Assessment['status'] = 'SUCCEEDED'): Assessment {
  return { id: 'assessment', skill: 'speaking', program: 'MULTILEVEL', status, policyMode: 'FULL_MOCK_AI_WITH_REVIEW', version: 1,
    aiScore: 51, teacherScore: null, finalScore: null, finalScoreSource: null, confidence: .8, rubricVersion: 'MULTILEVEL_SPEAKING_RUBRIC_V1', promptVersion: 'PROMPT_V1',
    evaluation: { result: { parts: [{ id: '3', rawScore: 4, criteria: {}, evidence: {}, feedback }], overallStrengths: ['Relevant ideas'], priorityImprovements: ['Balance arguments'],
      grammarCorrections: [{ original: 'It help', corrected: 'It helps', explanation: 'Subject agreement' }], vocabularyUpgrades: [{ original: 'good', alternative: 'beneficial', explanation: 'More precise' }],
      improvedExamples: [{ partId: '3', text: 'IMPROVED synthetic answer' }], recommendedPractice: ['Practise both sides'], confidence: .8, pronunciationEvidence: 'UNAVAILABLE' } },
    approvedFeedback: null, submissions: [{ questionId: 'q1', partId: '3', prompt: 'Discuss the topic', context: 'FOR and AGAINST', originalResponse: 'ORIGINAL <script>alert(1)</script>', wordCount: 3,
      audioUrl: '/v1/mock/attempts/attempt/answers/q1/audio', transcript: { text: 'Synthetic transcript', confidence: .9, segments: [{ start: 0, end: 1, text: 'Synthetic transcript', confidence: .9 }], pronunciationEvidence: 'UNAVAILABLE' } }],
    parts: [{ id: '3', max: 6, task: 'Part 3', context: 'Discussion' }] };
}

describe('assessment client contract and bounded status updates', () => {
  it('validates shared IELTS/Multilevel output while stripping backend-only metadata', () => {
    const parsed = assessmentAttemptSchema.parse({ attemptId: 'a', assessments: [{ ...fixture(), providerCredentials: 'must-not-render', evaluation: { ...fixture().evaluation, inputHash: 'private' } }] });
    expect(parsed.assessments[0]).not.toHaveProperty('providerCredentials');
    expect(parsed.assessments[0].evaluation).not.toHaveProperty('inputHash');
    expect(parsed.assessments[0].submissions[0].transcript?.text).toBe('Synthetic transcript');
  });
  it('rejects unknown status, invalid confidence and malformed rubric output', () => {
    for (const assessment of [{ ...fixture(), status: 'INVENTED' }, { ...fixture(), confidence: 2 }, { ...fixture(), evaluation: { result: { parts: [] } } }]) {
      expect(assessmentAttemptSchema.safeParse({ attemptId: 'a', assessments: [assessment] }).success).toBe(false);
    }
  });
  it.each(['PENDING', 'PROCESSING', 'RETRY'] as const)('polls active %s work only within the request/time caps', (status) => {
    const data = { attemptId: 'a', assessments: [fixture(status)] };
    expect(shouldPollAssessment(data, 19, 299_999)).toBe(true);
    expect(shouldPollAssessment(data, 20, 100)).toBe(false);
    expect(shouldPollAssessment(data, 0, 300_000)).toBe(false);
  });
  it.each(['SUCCEEDED', 'NEEDS_REVIEW', 'FAILED'] as const)('stops polling terminal %s work', (status) => {
    expect(shouldPollAssessment({ attemptId: 'a', assessments: [fixture(status)] }, 0, 0)).toBe(false);
  });
  it('stops when assessment feedback is absent or no jobs exist', () => {
    expect(shouldPollAssessment(undefined, 0, 0)).toBe(false);
    expect(shouldPollAssessment({ attemptId: 'a', assessments: [] }, 0, 0)).toBe(false);
  });
  it('distinguishes provisional AI, failed/manual review and teacher-reviewed results', () => {
    expect(assessmentStatus(fixture())).toContain('teacher confirmation required');
    expect(assessmentStatus(fixture('FAILED'))).toBe('Failed — manual review pending');
    expect(assessmentStatus({ ...fixture(), teacherScore: 55, finalScore: 55, finalScoreSource: 'TEACHER' })).toBe('Teacher reviewed');
  });
  it('uses only the authenticated assessment endpoint with an encoded attempt identifier', async () => {
    vi.mocked(get).mockResolvedValueOnce({ attemptId: 'a', assessments: [fixture()] });
    await expect(getAssessment('a/other')).resolves.toMatchObject({ attemptId: 'a' });
    expect(get).toHaveBeenLastCalledWith('/assessment/attempts/a%2Fother');
  });
});

describe('student assessment feedback preserves source evidence', () => {
  it('keeps original, transcript and improved example separate; marks pronunciation limitation and provisional scores', () => {
    const assessment = fixture(); const before = JSON.stringify(assessment);
    const html = renderToStaticMarkup(<AssessmentCard assessment={assessment} />);
    expect(html).toContain('ORIGINAL'); expect(html).toContain('IMPROVED EXAMPLE');
    expect(html).toContain('ORIGINAL &lt;script&gt;alert(1)&lt;/script&gt;'); expect(html).not.toContain('<script>');
    expect(html).toContain('Synthetic transcript'); expect(html).toContain('Load original audio');
    expect(html).toContain('Pronunciation evidence is unavailable'); expect(html).toContain('Provisional');
    expect(html).toContain('Holistic raw score: 4 / 6'); expect(html).toContain('AGAINST / OPPOSING: Missing');
    expect(html).toContain('Grammar corrections'); expect(html).toContain('Vocabulary alternatives');
    expect(JSON.stringify(assessment)).toBe(before);
  });
  it('displays teacher score separately from preserved AI estimate and teacher-approved feedback', () => {
    const assessment = fixture(); assessment.teacherScore = 55; assessment.finalScore = 55; assessment.finalScoreSource = 'TEACHER'; assessment.approvedFeedback = assessment.evaluation!.result;
    const html = renderToStaticMarkup(<AssessmentCard assessment={assessment} />);
    expect(html).toContain('Teacher reviewed'); expect(html).toContain('Original AI estimate: 51'); expect(html).toContain('Teacher score: 55');
    expect(html).toContain('teacher approved'); expect(html).not.toContain('Provisional');
  });
  it('does not fabricate a score or transcript when providers cannot complete', () => {
    const assessment = fixture('NEEDS_REVIEW'); assessment.aiScore = null; assessment.evaluation = null; assessment.confidence = null; assessment.submissions[0].transcript = null;
    const html = renderToStaticMarkup(<AssessmentCard assessment={assessment} />);
    expect(html).toContain('Teacher review required'); expect(html).toContain('Original audio is retained');
    expect(html).not.toContain('Estimated Multilevel Speaking Score');
  });
});

describe('automatic AI assessment status after submit', () => {
  it('reports progress while any job runs, and completion only once they settle', () => {
    expect(assessmentPhase(undefined)).toBe('none');
    expect(assessmentPhase({ attemptId: 'a', assessments: [] })).toBe('none');
    expect(assessmentPhase({ attemptId: 'a', assessments: [fixture('PENDING')] })).toBe('processing');
    expect(assessmentPhase({ attemptId: 'a', assessments: [fixture('RETRY')] })).toBe('processing');
    // A finished sibling skill must never hide work still in flight.
    expect(assessmentPhase({ attemptId: 'a', assessments: [fixture('SUCCEEDED'), fixture('PROCESSING')] })).toBe('processing');
    expect(assessmentPhase({ attemptId: 'a', assessments: [fixture('SUCCEEDED')] })).toBe('ready');
    expect(assessmentPhase({ attemptId: 'a', assessments: [fixture('NEEDS_REVIEW')] })).toBe('review');
    expect(assessmentPhase({ attemptId: 'a', assessments: [fixture('FAILED')] })).toBe('failed');
  });

  it('tells the student what is happening in their own terms', () => {
    expect(assessmentPhaseLabel('processing', 'Writing')).toContain('AI is analysing your Writing');
    expect(assessmentPhaseLabel('ready', 'Speaking')).toContain('AI feedback for your Speaking is ready');
    expect(assessmentPhaseLabel('review', 'Writing')).toContain('teacher review');
    expect(assessmentPhaseLabel('failed', 'Writing')).toContain('a teacher will grade it');
    expect(assessmentPhaseLabel('none', 'Writing')).toContain('answers are saved');
  });

  it('renders the live banner, and nothing at all for an unassessed attempt', () => {
    const html = renderToStaticMarkup(<AiAssessmentBanner phase="processing" skill="Writing" onRefresh={() => {}} refreshing={false} />);
    expect(html).toContain('role="status"');
    expect(html).toContain('AI is analysing your Writing');
    expect(html).toContain('Check now');
    const ready = renderToStaticMarkup(<AiAssessmentBanner phase="ready" skill="Speaking" onRefresh={() => {}} refreshing />);
    expect(ready).toContain('Checking…');
    expect(renderToStaticMarkup(<AiAssessmentBanner phase="none" skill="Writing" onRefresh={() => {}} refreshing={false} />)).toBe('');
  });
});

describe('spoken feedback', () => {
  it('reads the advice aloud and never reads the original answer back', () => {
    const speech = feedbackSpeechText(fixture());
    expect(speech).toContain('Estimated Multilevel Speaking score 51 out of 75');
    expect(speech).toContain('teacher confirmation required');
    expect(speech).toContain('Strengths: Relevant ideas');
    expect(speech).toContain('Priority improvements: Balance arguments');
    expect(speech).toContain('say It helps instead of It help');
    expect(speech).toContain('replace good with beneficial');
    expect(speech).toContain('Recommended next practice: Practise both sides');
    expect(speech).toContain('This is an AI estimate');
    expect(speech).not.toContain('script');
  });

  it('reads a teacher-approved result, and nothing while a job is still queued', () => {
    const approved = fixture(); approved.approvedFeedback = approved.evaluation!.result;
    expect(feedbackSpeechText(approved)).toContain('approved by your teacher');
    expect(feedbackSpeechText(approved)).not.toContain('This is an AI estimate');
    const queued = fixture('PENDING'); queued.evaluation = null;
    expect(feedbackSpeechText(queued)).toBeNull();
  });

  it('speaks once, cancels the previous reading and reports the end', () => {
    const speak = vi.fn(); const cancel = vi.fn();
    class Utterance { text: string; rate = 1; onend: (() => void) | null = null; onerror: (() => void) | null = null;
      constructor(text: string) { this.text = text; } }
    vi.stubGlobal('SpeechSynthesisUtterance', Utterance);
    vi.stubGlobal('window', { speechSynthesis: { speak, cancel }, SpeechSynthesisUtterance: Utterance });
    expect(speechFeedbackSupported()).toBe(true);
    const ended = vi.fn();
    expect(speakFeedback('Band 7. Read this.', ended)).toBe(true);
    expect(cancel).toHaveBeenCalledTimes(1);
    const utterance = speak.mock.calls[0][0] as Utterance;
    expect(utterance.text).toBe('Band 7. Read this.');
    utterance.onend?.();
    expect(ended).toHaveBeenCalledTimes(1);
    stopFeedbackSpeech();
    expect(cancel).toHaveBeenCalledTimes(2);
  });

  it('degrades to the written card when speech synthesis is unavailable', () => {
    expect(speechFeedbackSupported()).toBe(false);
    expect(speakFeedback('nothing to say')).toBe(false);
    expect(speakFeedback('')).toBe(false);
    expect(() => stopFeedbackSpeech()).not.toThrow();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });
});
