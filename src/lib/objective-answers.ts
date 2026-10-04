import { countWords } from './exam-types';

export type AnswerRule = 'ONE_WORD' | 'ONE_WORD_AND_OR_NUMBER';
interface AnswerConstraint { answerRule?: AnswerRule | null; wordLimit: number | null }

export function answerRuleHint(constraint: AnswerConstraint) {
  if (constraint.answerRule === 'ONE_WORD') return 'ONE WORD';
  if (constraint.answerRule === 'ONE_WORD_AND_OR_NUMBER') return 'ONE WORD AND/OR A NUMBER';
  return constraint.wordLimit == null ? null : `No more than ${constraint.wordLimit} word${constraint.wordLimit === 1 ? '' : 's'}`;
}

/** UI hint only; grading and accepted alternatives remain authoritative on the server. */
export function exceedsAnswerConstraint(value: string, constraint: AnswerConstraint) {
  const tokens = value.trim().split(/\s+/).filter(Boolean);
  if (!tokens.length) return false;
  if (constraint.answerRule) {
    const numeric = tokens.filter((token) => /^[+-]?\d+(?:[.,:/-]\d+)*%?$/.test(token)).length;
    const text = tokens.length - numeric;
    return constraint.answerRule === 'ONE_WORD' ? tokens.length !== 1 || numeric > 0 : text > 1 || numeric > 1;
  }
  return constraint.wordLimit != null && countWords(value) > constraint.wordLimit;
}
