/** Finalize only acknowledged answers. A definitive deadline verdict means
 * the server has closed the answer window; it can finalize its saved snapshot.
 * Network/auth/server failures retain the draft and keep submission retryable. */
export async function flushBeforeSubmission(
  save: () => Promise<void>,
  options: { versioned: boolean; auto: boolean },
  onSaveError: (error: unknown) => void,
) {
  try { await save(); }
  catch (error) {
    const code = error && typeof error === 'object' && 'code' in error ? error.code : undefined;
    if (options.auto && ['TEST_TIME_UP', 'MOCK_TIME_UP', 'MOCK_SECTION_TIME_UP'].includes(String(code))) {
      onSaveError(error);
      return;
    }
    throw error;
  }
}
