import { beforeEach, describe, expect, it, vi } from 'vitest';
import { uploadRetainedMockRecording } from './mock-recordings';
import { retainRecording, releaseRecording } from './durable-recordings';
import { uploadMockSpeaking } from './mocks';

vi.mock('./durable-recordings', () => ({ recordingKey: (attempt: string, question: string) => `${attempt}:${question}`, retainRecording: vi.fn(), releaseRecording: vi.fn() }));
vi.mock('./mocks', () => ({ uploadMockSpeaking: vi.fn() }));

describe('IELTS retained speaking upload', () => {
  beforeEach(() => { vi.resetAllMocks(); vi.mocked(retainRecording).mockResolvedValue('a:q'); vi.mocked(releaseRecording).mockResolvedValue(undefined); vi.mocked(uploadMockSpeaking).mockResolvedValue({ saved: true, audioUrl: '/audio' }); });
  it('releases the original only after upload acknowledgement', async () => {
    const blob = new Blob(['synthetic-audio'], { type: 'audio/webm' });
    await uploadRetainedMockRecording('a', 'q', blob, vi.fn());
    expect(retainRecording).toHaveBeenCalledWith('a:q', blob); expect(uploadMockSpeaking).toHaveBeenCalledWith('a', 'q', blob); expect(releaseRecording).toHaveBeenCalledWith('a:q');
    expect(vi.mocked(retainRecording).mock.invocationCallOrder[0]).toBeLessThan(vi.mocked(uploadMockSpeaking).mock.invocationCallOrder[0]);
    expect(vi.mocked(uploadMockSpeaking).mock.invocationCallOrder[0]).toBeLessThan(vi.mocked(releaseRecording).mock.invocationCallOrder[0]);
  });
  it('keeps the identical original take after network failure so a retry needs no re-recording', async () => {
    const blob = new Blob(['synthetic-audio']); vi.mocked(uploadMockSpeaking).mockRejectedValueOnce(new Error('offline'));
    await expect(uploadRetainedMockRecording('a', 'q', blob, vi.fn())).rejects.toThrow('offline'); expect(releaseRecording).not.toHaveBeenCalled();
    await uploadRetainedMockRecording('a', 'q', blob, vi.fn()); expect(uploadMockSpeaking).toHaveBeenNthCalledWith(2, 'a', 'q', blob);
  });
  it('warns about unavailable durable storage while allowing acknowledged upload of the retained memory take', async () => {
    vi.mocked(retainRecording).mockRejectedValueOnce(new Error('quota')); const warning = vi.fn();
    await uploadRetainedMockRecording('a', 'q', new Blob(['audio']), warning); expect(warning).toHaveBeenCalledOnce(); expect(uploadMockSpeaking).toHaveBeenCalledOnce();
  });
  it('rejects an empty take without upload or removal', async () => {
    await expect(uploadRetainedMockRecording('a', 'q', new Blob([]), vi.fn())).rejects.toThrow('empty'); expect(uploadMockSpeaking).not.toHaveBeenCalled(); expect(releaseRecording).not.toHaveBeenCalled();
  });
});
