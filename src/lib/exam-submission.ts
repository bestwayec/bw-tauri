/** Manual Multilevel finalization requires acknowledged answers. Expiry can
 * finalize the server snapshot because expired answers are no longer writable.
 * Keep the existing IELTS expiry/save policy unchanged. */
export async function flushBeforeSubmission(
  save: () => Promise<void>,
  options: { versioned: boolean; auto: boolean },
  onSaveError: (error: unknown) => void,
) {
  try { await save(); }
  catch (error) {
    if (options.versioned && !options.auto) throw error;
    onSaveError(error);
  }
}
