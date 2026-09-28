/**
 * Real student exam preferences — persisted locally, no backend involved.
 *
 * Only preferences that are actually read somewhere in the app belong here.
 * (Do not add toggles without wiring them to working functionality.)
 */

const CONFIRM_SUBMIT_KEY = "bestway.confirmBeforeSubmit";

/** Whether the runner asks for confirmation before submitting. Default true. */
export function getConfirmBeforeSubmit(): boolean {
  try {
    const raw = localStorage.getItem(CONFIRM_SUBMIT_KEY);
    if (raw == null) return true;
    return raw === "1";
  } catch {
    return true;
  }
}

export function setConfirmBeforeSubmit(value: boolean): void {
  try {
    localStorage.setItem(CONFIRM_SUBMIT_KEY, value ? "1" : "0");
  } catch {
    /* private mode — session-only */
  }
}
