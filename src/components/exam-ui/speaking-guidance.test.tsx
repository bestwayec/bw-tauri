import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { MockShapedQuestionSchema } from '@/lib/schemas';
import { SpeakingWidget } from './widgets';
import { mockSectionToParts, type UIQuestion } from './model';

function question(profile: string | null, prepSeconds = 5) {
  return MockShapedQuestionSchema.parse({ id: 'q', number: 1, sortOrder: 0, type: 'speaking_task', prompt: 'Speak about your home', points: 5, options: null, wordLimit: null,
    guidance: { taskKey: '1.1', prepSeconds, responseSeconds: 30, rawMax: 5, speakingProfileVersion: profile, profileLabel: 'BestWay product timing profile' } });
}
describe('server-owned Multilevel Speaking guidance', () => {
  it('preserves nullable historical timing metadata and versioned V2 metadata at the boundary', () => {
    expect(question(null, 0).guidance?.speakingProfileVersion).toBeNull();
    expect(question('BESTWAY_MULTILEVEL_SPEAKING_2026_V2').guidance).toMatchObject({ prepSeconds: 5, responseSeconds: 30, rawMax: 5 });
  });
  it('shows the server timing and one holistic part maximum rather than independent answer scores', () => {
    const data = question('BESTWAY_MULTILEVEL_SPEAKING_2026_V2', 7);
    const q: UIQuestion = { ...data, kind: 'speaking', recordingContext: { attemptId: 'a', timed: true, hasAudio: false } };
    const html = renderToStaticMarkup(<SpeakingWidget q={q} value="" fontSize={17} onChange={() => {}} />);
    expect(html).toContain('Preparation: 7 seconds'); expect(html).toContain('response: 30 seconds');
    expect(html).toContain('holistic score /5 across this part'); expect(html).toContain('BestWay product timing');
  });
  it('labels versioned speaking tabs from task keys while preserving IELTS part numbering', () => {
    const group = { id: 'g', sortOrder: 0, title: null, instructions: null, passageText: null, contentHtml: null, contentLayout: null,
      hasAudio: false, audioUrl: null, imageUrl: null, partNumber: null, audioDurationSec: null, audioPlayLimit: 0, questions: [question('BESTWAY_MULTILEVEL_SPEAKING_2026_V2')] };
    const section = { id: 's', skill: 'speaking' as const, title: null, sortOrder: 0, durationMinutes: null, instructions: null, groups: [group] };
    expect(mockSectionToParts(section, 'a', true)[0].label).toBe('Part 1.1');
    expect(mockSectionToParts({ ...section, groups: [{ ...group, questions: [{ ...group.questions[0], guidance: undefined }] }] }, 'a', true)[0].label).toBe('Part 1');
  });
});
