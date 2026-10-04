import { Children, isValidElement, type ReactElement } from 'react';
import { describe, expect, it } from 'vitest';
import { MultilevelListening } from '@/components/exam/multilevel-media';
import ListeningEngine from './ListeningEngine';
import { PartQuestions } from './ExamRunner';
import type { UIPart } from './model';

function renderAudio(groupId: string, attemptId = 'attempt', multilevel = true) {
  const part: UIPart = {
    key: groupId, label: groupId, title: null, instructions: null,
    passageText: null, contentHtml: null, imageUrl: null,
    audioUrl: `https://example.test/groups/${groupId}/audio`, strictAudio: true,
    ...(multilevel ? { multilevelAudio: { attemptId, groupId } } : {}),
    questions: [],
  };
  const tree = PartQuestions({
    part, gapped: false, cardQuestions: [], answers: {}, flags: {},
    uploadNotes: {}, fontSize: 17, onAnswer() {}, onToggleFlag() {},
  });
  const children = Children.toArray(tree.props.children);
  return children.find((child) => isValidElement(child) &&
    (child.type === MultilevelListening || child.type === ListeningEngine)) as ReactElement;
}

describe('listening player reconciliation across part navigation', () => {
  it('remounts Multilevel media for another group or attempt while preserving it on ordinary rerenders', () => {
    const first = renderAudio('part-1');
    const rerender = renderAudio('part-1');
    const nextPart = renderAudio('part-2');
    const nextAttempt = renderAudio('part-1', 'another-attempt');
    // React retains component state for the same type/key and destroys it for
    // a new key. The part's cached Blob URL and play count must follow this
    // identity so another group cannot reuse an earlier group's audio.
    expect(first.type).toBe(MultilevelListening);
    expect(first.key).not.toBeNull();
    expect(rerender.type).toBe(first.type);
    expect(rerender.key).toBe(first.key);
    expect(nextPart.key).not.toBe(first.key);
    expect(nextAttempt.key).not.toBe(first.key);
  });

  it('continues to render the existing IELTS engine with the current source', () => {
    const first = renderAudio('ielts-1', 'attempt', false);
    const next = renderAudio('ielts-2', 'attempt', false);
    expect(first.type).toBe(ListeningEngine);
    expect(next.type).toBe(ListeningEngine);
    expect(next.props).toMatchObject({ src: 'https://example.test/groups/ielts-2/audio', strict: true });
  });
});
