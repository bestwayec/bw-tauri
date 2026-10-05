import { Children, isValidElement, type ReactElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { MockShapedGroupSchema, MockShapedQuestionSchema } from '@/lib/schemas';
import type { MockShapedGroup, MockQuestionType, MockShapedSection } from '@/lib/mocks';
import { answerRuleHint, exceedsAnswerConstraint, parseMultiSelectAnswer, serializeMultiSelectAnswer } from '@/lib/objective-answers';
import { mockSectionToParts, widgetFor, type UIPart, type UIQuestion } from './model';
import QuestionGroup from './QuestionGroup';
import { CheckWidget, MatchingWidget, ShortWidget } from './widgets';

function group(type: MockQuestionType, layout: string | null, answerRule?: 'ONE_WORD' | 'ONE_WORD_AND_OR_NUMBER'): MockShapedGroup {
  return { id: 'synthetic-group', sortOrder: 0, title: 'Original park information', instructions: 'Use the original material.',
    passageText: 'A fictional park opens near the river. The gate is marked on the plan.', contentHtml: null,
    contentLayout: layout, optionsReusable: null, hasAudio: false, audioUrl: null, imageUrl: null,
    partNumber: null, audioDurationSec: null, audioPlayLimit: 0,
    questions: [{ id: 'question-1', number: 1, sortOrder: 0, type, prompt: 'Original synthetic prompt',
      options: ['multiple_choice', 'matching', 'matching_headings', 'map_labelling'].includes(type) ? ['Hill', 'Lake', 'Gate'] : null,
      points: 1, wordLimit: null, answerRule }],
  };
}
function section(groups: MockShapedGroup[], skill: MockShapedSection['skill'] = 'reading'): MockShapedSection {
  return { id: 'section', skill, title: null, sortOrder: 0, durationMinutes: null, instructions: null, groups };
}
const formats: Array<[string, MockQuestionType, string | null, string]> = [
  ['ONE_WORD_GAP_FILL', 'short_answer', null, 'short'], ['MULTIPLE_CHOICE', 'multiple_choice', null, 'radio'],
  ['TRUE_FALSE_NOT_GIVEN', 'true_false_notgiven', null, 'tfng'], ['HEADING_MATCH', 'matching_headings', 'headings', 'matching'],
  ['SHORT_TEXT_MATCH', 'matching', 'short_texts', 'matching'], ['PARAGRAPH_MATCH', 'matching', 'paragraphs', 'matching'],
  ['NOTE_COMPLETION', 'note_completion', 'notes', 'inline'], ['SENTENCE_COMPLETION', 'sentence_completion', null, 'inline'],
  ['SPEAKER_MATCH', 'matching', 'speakers', 'matching'], ['MATCHING', 'matching', null, 'matching'],
  ['MAP_PLAN_LABEL', 'map_labelling', 'map', 'map'], ['MULTI_EXTRACT_MCQ', 'multiple_choice', 'multi_extract', 'radio'],
];

describe('shared desktop Reading and Listening formats', () => {
  it.each(formats)('validates/adapts original %s material and strips answer keys', (name, type, layout, widget) => {
    const authored = group(type, layout, name === 'ONE_WORD_GAP_FILL' ? 'ONE_WORD' : undefined);
    const parsed = MockShapedGroupSchema.parse({ ...authored, audioScript: 'PRIVATE TRANSCRIPT', questions: authored.questions.map((question) => ({ ...question, correctAnswers: ['SECRET KEY'], acceptedVariants: ['PRIVATE ALTERNATIVE'] })) });
    expect(parsed).not.toHaveProperty('audioScript');
    expect(parsed.questions[0]).not.toHaveProperty('correctAnswers');
    expect(parsed.questions[0]).not.toHaveProperty('acceptedVariants');
    const part = mockSectionToParts(section([parsed]), 'attempt', false)[0];
    expect(part.contentLayout).toBe(layout);
    expect(part.passageText).toContain('fictional park');
    expect(widgetFor(part.questions[0].kind, !!part.questions[0].options?.length)).toBe(widget);
    const html = renderToStaticMarkup(<QuestionGroup part={part} answers={{}} flags={{}} fontSize={15} onAnswer={() => {}} onToggleFlag={() => {}} />);
    expect(html).toContain('Original synthetic prompt'); expect(html).not.toContain('SECRET KEY'); expect(html).not.toContain('PRIVATE ALTERNATIVE');
  });
  it('keeps separate extract audio/groups and old IELTS question numbering', () => {
    const first = { ...group('multiple_choice', 'multi_extract'), id: 'extract-1', hasAudio: true, audioUrl: '/v1/mock/groups/extract-1/audio' };
    const second = { ...group('multiple_choice', 'multi_extract'), id: 'extract-2', sortOrder: 1, hasAudio: true, audioUrl: '/v1/mock/groups/extract-2/audio', questions: [{ ...first.questions[0], id: 'question-2', number: 2 }] };
    const parts = mockSectionToParts(section([first, second], 'listening'), 'attempt', true);
    expect(parts.map((part) => part.label)).toEqual(['Extract 1', 'Extract 2']);
    expect(parts[0].audioUrl).not.toBe(parts[1].audioUrl);
    expect(parts.flatMap((part) => part.questions.map((question) => question.number))).toEqual([1, 2]);
    expect(parts.every((part) => part.strictAudio)).toBe(true);
  });
  it('supports a typed map answer when an author supplied no option bank', () => {
    expect(widgetFor('map_label', false)).toBe('short');
    expect(widgetFor('map_label', true)).toBe('map');
  });
  it('rejects invalid answer rules and strips arbitrary provider/server metadata', () => {
    const question = group('short_answer', null).questions[0];
    expect(MockShapedQuestionSchema.safeParse({ ...question, answerRule: 'ANY_SEMANTIC_ANSWER' }).success).toBe(false);
    expect(MockShapedQuestionSchema.parse({ ...question, secretMetadata: 'private' })).not.toHaveProperty('secretMetadata');
  });
});

function matchingElements(node: ReactNode): ReactElement<{ taken: string[] }>[] {
  return Children.toArray(node).flatMap((child) => {
    if (!isValidElement(child)) return [];
    const element = child as ReactElement<{ children?: ReactNode; taken: string[] }>;
    return element.type === MatchingWidget ? [element] : matchingElements(element.props.children);
  });
}
function matchingPart(optionsReusable?: boolean | null): UIPart {
  const part = mockSectionToParts(section([group('matching', 'paragraphs')]), 'attempt', false)[0];
  return { ...part, optionsReusable, questions: [part.questions[0], { ...part.questions[0], id: 'question-2', number: 2 }] };
}
describe('configured matching reuse', () => {
  it.each([undefined, null, false])('preserves one-use IELTS options for legacy/false %s', (optionsReusable) => {
    const tree = QuestionGroup({ part: matchingPart(optionsReusable), answers: { 'question-1': 'Hill' }, flags: {}, fontSize: 15, onAnswer() {}, onToggleFlag() {} });
    expect(matchingElements(tree)[1].props.taken).toEqual(['Hill']);
  });
  it('allows paragraph or speaker options to be reused only when explicitly configured', () => {
    const tree = QuestionGroup({ part: matchingPart(true), answers: { 'question-1': 'Hill' }, flags: {}, fontSize: 15, onAnswer() {}, onToggleFlag() {} });
    expect(matchingElements(tree)[1].props.taken).toEqual([]);
  });
  it('includes siblings omitted from the visible question subset in one-use enforcement', () => {
    const part = matchingPart(false);
    const tree = QuestionGroup({ part, only: [part.questions[1]], answers: { 'question-1': 'Hill' }, flags: {}, fontSize: 15, onAnswer() {}, onToggleFlag() {} });
    expect(matchingElements(tree)[0].props.taken).toEqual(['Hill']);
  });
});

describe('explicit completion answer rules', () => {
  const one = { answerRule: 'ONE_WORD' as const, wordLimit: 5 };
  const mixed = { answerRule: 'ONE_WORD_AND_OR_NUMBER' as const, wordLimit: 1 };
  it('shows ONE WORD and gives explicit rules precedence over legacy word limits', () => {
    expect(answerRuleHint(one)).toBe('ONE WORD');
    expect(exceedsAnswerConstraint('river', one)).toBe(false);
    expect(exceedsAnswerConstraint('north river', one)).toBe(true);
    expect(exceedsAnswerConstraint('7', one)).toBe(true);
  });
  it('allows one text token and/or one numeric token without accepting arbitrary extra words', () => {
    expect(answerRuleHint(mixed)).toBe('ONE WORD AND/OR A NUMBER');
    for (const answer of ['gate', '7', 'gate 7']) expect(exceedsAnswerConstraint(answer, mixed)).toBe(false);
    for (const answer of ['north gate', '7 8', 'north gate 7']) expect(exceedsAnswerConstraint(answer, mixed)).toBe(true);
    expect(exceedsAnswerConstraint('one two', { wordLimit: 2 })).toBe(false);
    expect(exceedsAnswerConstraint('one two three', { wordLimit: 2 })).toBe(true);
  });
  it('uses actual Unicode words and a shared numeric grammar for explicit answer rules', () => {
    for (const answer of ['-7', '07:30', '7%', '2026-10-05']) {
      expect(exceedsAnswerConstraint(answer, one)).toBe(true);
      expect(exceedsAnswerConstraint(answer, mixed)).toBe(false);
    }
    for (const answer of ['mother-in-law', 'teacher’s', 'café']) expect(exceedsAnswerConstraint(answer, one)).toBe(false);
    for (const answer of ['!!!', 'word7', '7%%']) {
      expect(exceedsAnswerConstraint(answer, one)).toBe(true);
      expect(exceedsAnswerConstraint(answer, mixed)).toBe(true);
    }
    expect(exceedsAnswerConstraint('word7', { wordLimit: 1 })).toBe(false);
  });
  it('renders the actual rule and preserves the exact typed answer without client grading', () => {
    const question: UIQuestion = { id: 'q', number: 1, kind: 'short_answer', prompt: 'Original prompt', options: null, points: 1, wordLimit: 5, answerRule: 'ONE_WORD' };
    const html = renderToStaticMarkup(<ShortWidget q={question} value="  North Gate  " fontSize={15} onChange={() => {}} />);
    expect(html).toContain('ONE WORD'); expect(html).toContain('aria-invalid="true"'); expect(html).toContain('value="  North Gate  "');
  });
});

describe('multi-select serialization and resume', () => {
  const options = ['Morning, afternoon', 'Parks; gardens', 'Evening'];
  it('round-trips punctuation in selected option labels through autosave strings', () => {
    const wire = serializeMultiSelectAnswer(options.slice(0, 2));
    expect(JSON.parse(wire)).toEqual(options.slice(0, 2));
    expect(parseMultiSelectAnswer(wire, options)).toEqual(options.slice(0, 2));
    expect(serializeMultiSelectAnswer([])).toBe('');
  });
  it('restores legacy text, comma/semicolon keys and whitespace letter-key answers', () => {
    expect(parseMultiSelectAnswer('Morning, afternoon', options)).toEqual([options[0]]);
    for (const wire of ['A,B', 'A;B', 'A B', '["A","B"]']) expect(parseMultiSelectAnswer(wire, options)).toEqual(options.slice(0, 2));
    expect(parseMultiSelectAnswer('river,lake', ['river', 'lake', 'hill'])).toEqual(['river', 'lake']);
    expect(parseMultiSelectAnswer('["missing"]', options)).toEqual([]);
    expect(parseMultiSelectAnswer('["A",2]', options)).toEqual([]);
    expect(parseMultiSelectAnswer('[invalid', options)).toEqual([]);
  });
  it('selects the right resumed checkboxes and saves an unambiguous wire on toggle', () => {
    const question: UIQuestion = { id: 'q', number: 1, kind: 'multi_select', prompt: 'Choose two', options, points: 1, wordLimit: null };
    let saved = '';
    const tree = CheckWidget({ q: question, value: '["A","B"]', fontSize: 15, onChange: (value) => { saved = value; } });
    function inputs(node: ReactNode): ReactElement<{ checked: boolean; onChange: () => void }>[] {
      return Children.toArray(node).flatMap((child) => {
        if (!isValidElement(child)) return [];
        const element = child as ReactElement<{ children?: ReactNode; checked: boolean; onChange: () => void }>;
        return element.type === 'input' ? [element] : inputs(element.props.children);
      });
    }
    const controls = inputs(tree);
    expect(controls.map((input) => input.props.checked)).toEqual([true, true, false]);
    controls[1].props.onChange();
    expect(JSON.parse(saved)).toEqual([options[0]]);
    const html = renderToStaticMarkup(<CheckWidget q={question} value={saved} fontSize={15} onChange={() => {}} />);
    expect(html).toContain('1 selected');
    expect(html).toContain('Morning, afternoon');
  });
});
