import { Children, isValidElement, type ReactElement } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { MultilevelListening } from '@/components/exam/multilevel-media';
import ListeningEngine from './ListeningEngine';
import { PartQuestions, restoreAnswers, startDeadlineMonitor } from './ExamRunner';
import type { UIPart } from './model';

describe('answer recovery', () => {
  it('uses server answers for acknowledged edits and restores unsaved edits, including clears', () => {
    const server = { saved: 'new server answer', pending: 'old answer', cleared: 'old answer' };
    const queue = {
      answers: { saved: 'stale local answer', pending: 'offline answer', cleared: '' },
      dirty: ['pending', 'cleared'],
    };
    expect(restoreAnswers(server, queue)).toEqual({
      saved: 'new server answer', pending: 'offline answer', cleared: '',
    });
  });

  it('does not restore answers from another section of a versioned exam', () => {
    expect(restoreAnswers({ other: 'server' }, {
      answers: { current: 'unsaved', other: 'stale' }, dirty: ['current', 'other'],
    }, new Set(['current']))).toEqual({ current: 'unsaved', other: 'server' });
  });
});

describe('deadline submission', () => {
  it('retries after a failed submission and stops when the runner unmounts', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('window', globalThis);
    try {
      const submit = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce(undefined);
      const stop = startDeadlineMonitor(() => 0, () => { void submit().catch(() => undefined); });
      await vi.advanceTimersByTimeAsync(1000);
      expect(submit).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(9000);
      expect(submit).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(1000);
      expect(submit).toHaveBeenCalledTimes(2);
      stop();
      await vi.advanceTimersByTimeAsync(10_000);
      expect(submit).toHaveBeenCalledTimes(2);
    } finally {
      vi.unstubAllGlobals();
      vi.useRealTimers();
    }
  });
});

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
