/** Django mock_attempts.start_response issues this per-attempt HMAC. It is
 * echoed alongside bearer authentication; it is not a replacement for it. */
const signatures = new Map<string, string>();
const key = (attemptId: string) => `bestway.attempt-signature.${attemptId}`;

export function rememberAttemptSignature(payload: unknown): void {
  if (!payload || typeof payload !== 'object') return;
  const { attemptId, sessionSignature } = payload as Record<string, unknown>;
  if (typeof attemptId !== 'string' || typeof sessionSignature !== 'string' || !/^[a-f0-9]{64}$/.test(sessionSignature)) return;
  signatures.set(attemptId, sessionSignature);
  try { localStorage.setItem(key(attemptId), sessionSignature); } catch { /* memory still works */ }
}

export function attemptSignatureHeaders(path: string): Record<string, string> {
  const id = /^\/mock\/attempts\/([^/]+)(?:\/|$)/.exec(path)?.[1];
  if (!id) return {};
  let attemptId: string;
  try { attemptId = decodeURIComponent(id); } catch { return {}; }
  let signature = signatures.get(attemptId);
  try { signature ??= localStorage.getItem(key(attemptId)) ?? undefined; } catch { /* no storage */ }
  return signature && /^[a-f0-9]{64}$/.test(signature) ? { 'X-Attempt-Signature': signature } : {};
}
