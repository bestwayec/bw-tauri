/**
 * Offline exam cache + background answer sync.
 *
 * The exam payload (questions, passages, media URLs) is cached the moment an
 * attempt starts, so a restart or drop-out does not need the network to rebuild
 * the runner. Answers are mirrored locally per question and a 10-second worker
 * flushes them to the server, silently when the student is offline and
 * automatically as soon as the connection returns.
 */
import { offlineDelete, offlineGet, offlineList, offlinePut, offlinePurge } from './offline-store';

/** Background sync cadence while an attempt is open. */
export const OFFLINE_SYNC_INTERVAL_MS = 10_000;

/** What the runner shows for the sync indicator. */
export type OfflineSyncState = 'synced' | 'pending' | 'offline';

const EXAM_NAMESPACE = 'exam';
const answersNamespace = (attemptId: string) => `answers.${attemptId}`;

function isOnline(): boolean {
  try {
    return typeof navigator === 'undefined' || navigator.onLine !== false;
  } catch {
    return true;
  }
}

/** Cache the whole shaped exam for this attempt (sections → groups → questions). */
export async function cacheExamPayload(attemptId: string, payload: unknown): Promise<boolean> {
  try {
    return await offlinePut(EXAM_NAMESPACE, attemptId, JSON.stringify(payload));
  } catch {
    return false;
  }
}

/** The cached exam payload, or null when nothing (readable) is stored. */
export async function readCachedExam<T = unknown>(attemptId: string): Promise<T | null> {
  try {
    const raw = await offlineGet(EXAM_NAMESPACE, attemptId);
    if (!raw) return null;
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

/** Mirror one answer locally before it reaches the server. */
export async function cacheAnswer(
  attemptId: string,
  questionId: string,
  response: string,
): Promise<boolean> {
  try {
    return await offlinePut(
      answersNamespace(attemptId),
      questionId,
      JSON.stringify({ questionId, response, at: Date.now() }),
    );
  } catch {
    return false;
  }
}

/** A locally mirrored answer that the server has not acknowledged yet. */
export interface MirroredAnswer {
  questionId: string;
  response: string;
  at?: number;
}

/**
 * The mirrored (not yet acknowledged) answers, oldest write first.
 *
 * Read on mount by the runner: an answer a student gave while the connection
 * was down exists only here, so it must be restored into the exam instead of
 * silently disappearing.
 */
export async function readPendingAnswers(attemptId: string): Promise<MirroredAnswer[]> {
  const entries = await offlineList(answersNamespace(attemptId));
  const out: MirroredAnswer[] = [];
  for (const entry of entries) {
    try {
      const parsed = JSON.parse(entry.value) as Partial<MirroredAnswer>;
      if (typeof parsed?.questionId !== 'string' || typeof parsed.response !== 'string') continue;
      out.push({
        questionId: parsed.questionId,
        response: parsed.response,
        ...(typeof parsed.at === 'number' ? { at: parsed.at } : {}),
      });
    } catch {
      /* a corrupt mirror entry must never break the restore path */
    }
  }
  return out.sort((a, b) => (a.at ?? 0) - (b.at ?? 0));
}

/** How many locally mirrored answers have not been acknowledged yet. */
export async function pendingAnswerCount(attemptId: string): Promise<number> {
  return (await offlineList(answersNamespace(attemptId))).length;
}

/** Drop exactly the answers the server acknowledged; returns how many went. */
export async function resolvePendingAnswers(
  attemptId: string,
  syncedQuestionIds: string[],
): Promise<number> {
  const synced = new Set(syncedQuestionIds);
  const pending = await offlineList(answersNamespace(attemptId));
  let removed = 0;
  for (const entry of pending) {
    if (!synced.has(entry.key)) continue;
    if (await offlineDelete(answersNamespace(attemptId), entry.key)) removed++;
  }
  return removed;
}

/** Forget everything cached for a finished attempt. */
export async function clearAttemptCache(attemptId: string): Promise<void> {
  await offlineDelete(EXAM_NAMESPACE, attemptId).catch(() => false);
  await offlinePurge(answersNamespace(attemptId)).catch(() => undefined);
}

/**
 * Start the background sync worker for one attempt.
 *
 * - flushes immediately, then every `intervalMs` (default 10s)
 * - flushes again as soon as the window reports it is back online
 * - never throws and never runs two flushes at once; a failed flush while
 *   online reports `'pending'`, while offline it reports `'offline'`
 * - returns a cleanup function that stops the interval and the listeners
 */
export function startOfflineSync(opts: {
  attemptId: string;
  flush: () => Promise<void>;
  onState?: (state: OfflineSyncState) => void;
  intervalMs?: number;
}): () => void {
  const { flush, onState, intervalMs, attemptId } = opts;
  let inFlight = false;
  let stopped = false;

  async function run(force = false): Promise<void> {
    if (stopped || inFlight) return;
    if (!force && !isOnline()) {
      onState?.('offline');
      return;
    }
    inFlight = true;
    try {
      await flush();
      if (!stopped) onState?.('synced');
    } catch {
      // Offline answers are already mirrored locally — report, never throw.
      if (!stopped) onState?.(isOnline() ? 'pending' : 'offline');
    } finally {
      inFlight = false;
    }
  }

  // Answers left over from a previous run are pending until the first flush.
  void pendingAnswerCount(attemptId).then((count) => {
    if (!stopped && count > 0) onState?.('pending');
  });

  const timer = setInterval(() => {
    void run();
  }, intervalMs ?? OFFLINE_SYNC_INTERVAL_MS);
  const onOnline = () => {
    void run(true);
  };
  const onOffline = () => {
    onState?.('offline');
  };
  try {
    if (typeof window !== 'undefined') {
      window.addEventListener('online', onOnline);
      window.addEventListener('offline', onOffline);
    }
  } catch {
    /* no window (server rendering / node tests) */
  }

  void run();

  return () => {
    stopped = true;
    clearInterval(timer);
    try {
      if (typeof window !== 'undefined') {
        window.removeEventListener('online', onOnline);
        window.removeEventListener('offline', onOffline);
      }
    } catch {
      /* ignore */
    }
  };
}
