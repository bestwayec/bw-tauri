import { countWords } from './exam-types';

export type AnswerRule = 'ONE_WORD' | 'ONE_WORD_AND_OR_NUMBER';
interface AnswerConstraint { answerRule?: AnswerRule | null; wordLimit: number | null }

const normalizedChoice = (value: string) => value.normalize('NFKC').trim().toLocaleLowerCase('en').replace(/\s+/g, ' ');

/** JSON preserves punctuation in option labels; accept historical text/letter wires on resume. */
export function parseMultiSelectAnswer(value: string, options: readonly string[]): string[] {
  const response = value.trim();
  if (!response) return [];
  let selected: string[];
  if (response.startsWith('[')) {
    try {
      const parsed: unknown = JSON.parse(response);
      if (!Array.isArray(parsed) || !parsed.every((option) => typeof option === 'string')) return [];
      selected = parsed;
    } catch { return []; }
  } else {
    const literal = options.find((option) => normalizedChoice(option) === normalizedChoice(response));
    selected = literal !== undefined ? [literal] : /^[a-z](?:\s+[a-z])+$/i.test(response)
      ? response.split(/\s+/) : response.split(/[,;]+/).map((option) => option.trim()).filter(Boolean);
  }
  const resolved = selected.map((option) => {
    const key = normalizedChoice(option);
    const literal = options.find((candidate) => normalizedChoice(candidate) === key);
    if (literal !== undefined) return literal;
    return /^[a-z]$/.test(key) ? options[key.charCodeAt(0) - 97] : undefined;
  });
  if (resolved.some((option) => option === undefined)) return [];
  const chosen = new Set(resolved);
  return options.filter((option) => chosen.has(option));
}

export function serializeMultiSelectAnswer(selected: readonly string[]): string {
  return selected.length ? JSON.stringify(selected) : '';
}

export function answerRuleHint(constraint: AnswerConstraint) {
  if (constraint.answerRule === 'ONE_WORD') return 'ONE WORD';
  if (constraint.answerRule === 'ONE_WORD_AND_OR_NUMBER') return 'ONE WORD AND/OR A NUMBER';
  return constraint.wordLimit == null ? null : `No more than ${constraint.wordLimit} word${constraint.wordLimit === 1 ? '' : 's'}`;
}

/** UI hint only; grading and accepted alternatives remain authoritative on the server. */
export function exceedsAnswerConstraint(value: string, constraint: AnswerConstraint) {
  const tokens = value.normalize('NFKC').trim().split(/\s+/).filter(Boolean);
  if (!tokens.length) return false;
  if (constraint.answerRule) {
    const numeric = tokens.filter((token) => /^[+-]?\d+(?:[.,:/-]\d+)*%?$/.test(token)).length;
    const words = tokens.filter((token) => /^[\p{L}]+(?:[-'’][\p{L}]+)*$/u.test(token)).length;
    if (words + numeric !== tokens.length) return true;
    return constraint.answerRule === 'ONE_WORD' ? tokens.length !== 1 || words !== 1 : words > 1 || numeric > 1;
  }
  return constraint.wordLimit != null && countWords(value) > constraint.wordLimit;
}
