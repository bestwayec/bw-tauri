import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { assessmentAttemptSchema, assessmentStatus, getAssessment, shouldPollAssessment, type Assessment } from './assessment';
import { AssessmentCard } from '@/components/assessment/AssessmentFeedback';
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
