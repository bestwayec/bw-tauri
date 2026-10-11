import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';
import { startFullSpeakingCapture } from './speaking-capture';
import { MultilevelRecorder } from '@/components/exam/multilevel-media';

class FakeRecorder {
  state: RecordingState = 'inactive';
  mimeType = 'audio/webm';
  ondataavailable: ((event: { data: Blob }) => void) | null = null;
  onstop: (() => void) | null = null;
  onerror: (() => void) | null = null;
  empty = false;
  start() { this.state = 'recording'; }
  stop() { this.state = 'inactive'; this.ondataavailable?.({ data: new Blob(this.empty ? [] : ['audio samples']) }); this.onstop?.(); }
}
const callbacks = () => ({ complete: vi.fn(), interrupted: vi.fn(), failed: vi.fn() });
const capture = (recorder: FakeRecorder, duration: number, events: ReturnType<typeof callbacks>) => startFullSpeakingCapture(recorder as unknown as MediaRecorder, duration, events);
beforeEach(() => vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance'] }));
afterEach(() => vi.useRealTimers());

describe('native full Speaking response capture', () => {
  it.each([30, 45, 120])('captures the full %s-second window and stops only at its end', async (duration) => {
    const recorder = new FakeRecorder(), events = callbacks();
    const take = capture(recorder, duration, events);
    await vi.advanceTimersByTimeAsync(3000);
    expect(events.complete).not.toHaveBeenCalled();
    expect(take.remaining()).toBe(duration - 3);
    await vi.advanceTimersByTimeAsync((duration - 3) * 1000 - 1);
    expect(recorder.state).toBe('recording');
    await vi.advanceTimersByTimeAsync(1);
    expect(recorder.state).toBe('inactive');
    expect(events.complete).toHaveBeenCalledOnce();
    expect(events.complete.mock.calls[0][0]).toMatchObject({ type: 'audio/webm' });
    expect(events.interrupted).not.toHaveBeenCalled();
  });
  it('does not subtract API/preparation latency from native recording time', async () => {
    await vi.advanceTimersByTimeAsync(60800);
    const recorder = new FakeRecorder(), events = callbacks();
    capture(recorder, 120, events);
    await vi.advanceTimersByTimeAsync(119999);
    expect(events.complete).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(events.complete).toHaveBeenCalledOnce();
  });
  it.each(['native stop', 'device error', 'navigation'])('discards a three-second take interrupted by %s', async (reason) => {
    const recorder = new FakeRecorder(), events = callbacks();
    const take = capture(recorder, 30, events);
    await vi.advanceTimersByTimeAsync(3000);
    if (reason === 'native stop') recorder.stop();
    else if (reason === 'device error') recorder.onerror?.();
    else take.cancel();
    await vi.advanceTimersByTimeAsync(30000);
    expect(events.complete).not.toHaveBeenCalled();
    expect(events.interrupted).toHaveBeenCalledOnce();
  });
  it('rejects an empty full-window recording', async () => {
    const recorder = new FakeRecorder(), events = callbacks(); recorder.empty = true;
    capture(recorder, 30, events); await vi.advanceTimersByTimeAsync(30000);
    expect(events.complete).not.toHaveBeenCalled(); expect(events.failed).toHaveBeenCalledOnce();
  });
  it.each([0, Number.NaN, 121])('does not start native capture with invalid duration %s', (duration) => {
    const recorder = new FakeRecorder();
    expect(() => capture(recorder, duration, callbacks())).toThrow('Speaking timing');
    expect(recorder.state).toBe('inactive');
  });
  it('provides no early Stop control in practice or timed responses', () => {
    for (const timed of [false, true]) {
      const markup = renderToStaticMarkup(createElement(MultilevelRecorder, { attemptId: 'a', questionId: 'q', timed, initialHasAudio: false, startPhase: vi.fn(), upload: vi.fn() }));
      expect(markup).not.toContain('Stop recording');
      expect(markup).toContain('Test microphone');
    }
  });
});
