import { describe, expect, it, vi } from 'vitest';
import { flushBeforeSubmission } from './exam-submission';

describe('answer acknowledgement before finalization', () => {
  it('prevents manual Multilevel submission on an offline save, then permits retry', async () => {
    const save = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce(undefined);
    const submit = vi.fn();
    await expect(flushBeforeSubmission(save, { versioned: true, auto: false }, vi.fn()).then(submit)).rejects.toThrow('offline');
    expect(submit).not.toHaveBeenCalled();
    await flushBeforeSubmission(save, { versioned: true, auto: false }, vi.fn()).then(submit);
    expect(submit).toHaveBeenCalledOnce();
  });
  it('waits for an in-flight save before submitting', async () => {
    let acknowledge!: () => void;
    const pending = new Promise<void>((resolve) => { acknowledge = resolve; });
    const submit = vi.fn();
    const finishing = flushBeforeSubmission(() => pending, { versioned: true, auto: false }, vi.fn()).then(submit);
    await Promise.resolve();
    expect(submit).not.toHaveBeenCalled();
    acknowledge(); await finishing;
    expect(submit).toHaveBeenCalledOnce();
  });
  it.each([{versioned:true,auto:true},{versioned:false,auto:false}])('preserves server expiry and IELTS behavior: %j', async (options) => {
    const warning = vi.fn();
    await expect(flushBeforeSubmission(() => Promise.reject(new Error('expired')), options, warning)).resolves.toBeUndefined();
    expect(warning).toHaveBeenCalledOnce();
  });
});
