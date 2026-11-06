import { beforeEach, expect, it, vi } from 'vitest';
import { get, post } from './api';
import { submitAttempt } from './tests';
import { MockSubmitResultSchema } from './schemas';
vi.mock('./api', () => ({ get: vi.fn(), post: vi.fn() }));
beforeEach(() => vi.resetAllMocks());

it('recovers a confirmed result after a successful submission response was lost', async () => {
  vi.mocked(post).mockRejectedValue({ code: 'ATTEMPT_FINISHED', status: 400 });
  vi.mocked(get).mockResolvedValue({ status: 'completed', autoScore: 15 });
  await expect(submitAttempt('attempt')).resolves.toEqual({ status: 'completed', autoScore: 15 });
  expect(get).toHaveBeenCalledWith('/tests/attempts/attempt');
});
it.each([null, { status: 'in_progress', autoScore: 0 }, { status: 'completed' }])('rejects an unconfirmed submission receipt: %j', async result => {
  vi.mocked(post).mockResolvedValue(result);
  await expect(submitAttempt('attempt')).rejects.toMatchObject({ code: 'SCHEMA_MISMATCH' });
});
it('does not turn a failed result lookup into a successful submission', async () => {
  vi.mocked(post).mockRejectedValue({ code: 'ATTEMPT_FINISHED' });
  vi.mocked(get).mockRejectedValue(new Error('offline'));
  await expect(submitAttempt('attempt')).rejects.toThrow('offline');
});
it('does not interpret in_progress as a successful mock submission', () => {
  expect(MockSubmitResultSchema.safeParse({ status: 'in_progress', rawScores: {}, sectionBands: null, overallBand: null, cefrLevel: null }).success).toBe(false);
});
