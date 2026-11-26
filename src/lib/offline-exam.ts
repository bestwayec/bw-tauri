/**
 * Offline exam cache + background answer sync.
 *
 * The exam payload (questions, passages, media URLs) is cached the moment an
 * attempt starts, so a restart or drop-out does not need the network to rebuild
 * the runner. Answers are mirrored locally per question and a 10-second worker
 * flushes them to the server, silently when the student is offline and
 * automatically as soon as the connection returns.
 */
import {
  offlineDelete,
  offlineDeleteIfValue,
  offlineGet,
  offlineListStrict,
  offlinePut,
  offlinePutDurable,
  offlinePurge,
  type DurabilityTier,
} from './offline-store';

/** Background sync cadence while an attempt is open. */
export const OFFLINE_SYNC_INTERVAL_MS = 10_000;

/** What the runner shows for the sync indicator. */
export type OfflineSyncState = 'synced' | 'pending' | 'offline';

/** Explicit durability states for exam answers (Zero Silent Data Loss). */
export type AnswerDurabilityState =
  | 'server_acknowledged'
  | 'locally_persisted'
  | 'pending_sync'
  | 'memory_only'
  | 'persistence_failed'
  | 'conflict_detected';

export interface DurableAnswerResult {
  ok: boolean;
  tier: DurabilityTier;
  state: AnswerDurabilityState;
  error?: string;
}

const EXAM_NAMESPACE = 'exam';
const TIMER_NAMESPACE = 'timer';
const UNACCEPTED_NAMESPACE = 'unaccepted';
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

// Preserve keystroke order even when separate IndexedDB opens finish out of order.
const answerWrites = new Map<string, Promise<DurableAnswerResult>>();

/**
 * Mirror one answer locally with explicit durability feedback before it reaches the server.
 */
export async function cacheAnswerDurable(
  attemptId: string,
  questionId: string,
  response: string,
  opts?: { editedAt?: number; accountId?: string },
): Promise<DurableAnswerResult> {
  const key = `${attemptId}:${questionId}`;
  const previous = answerWrites.get(key) ?? Promise.resolve<DurableAnswerResult>({
    ok: true,
    tier: 'indexeddb',
    state: 'locally_persisted',
  });
  const payload: MirroredAnswer = {
    questionId,
    response,
    at: Date.now(),
    ...(typeof opts?.editedAt === 'number' && Number.isFinite(opts.editedAt) ? { editedAt: opts.editedAt } : {}),
    ...(opts?.accountId ? { accountId: opts.accountId } : {}),
  };
  const entry = JSON.stringify(payload);
  const write = previous
    .catch((): DurableAnswerResult => ({ ok: false, tier: 'failed', state: 'persistence_failed' }))
    .then(async (): Promise<DurableAnswerResult> => {
      const res = await offlinePutDurable(answersNamespace(attemptId), questionId, entry);
      if (res.ok) {
        return { ok: true, tier: res.tier, state: 'locally_persisted', ...(res.error ? { error: res.error } : {}) };
      }
      if (res.tier === 'memory') {
        return { ok: false, tier: 'memory', state: 'memory_only', ...(res.error ? { error: res.error } : {}) };
      }
      return { ok: false, tier: 'failed', state: 'persistence_failed', ...(res.error ? { error: res.error } : {}) };
    });
  answerWrites.set(key, write);
  try {
    return await write;
  } catch (err) {
    return {
      ok: false,
      tier: 'failed',
      state: 'persistence_failed',
      error: err instanceof Error ? err.message : 'Local persistence failed',
    };
  } finally {
    if (answerWrites.get(key) === write) answerWrites.delete(key);
  }
}

/** Mirror one answer locally before it reaches the server. */
export async function cacheAnswer(
  attemptId: string,
  questionId: string,
  response: string,
  opts?: { editedAt?: number; accountId?: string },
): Promise<boolean> {
  const res = await cacheAnswerDurable(attemptId, questionId, response, opts);
  return res.ok;
}

/** A locally mirrored answer that the server has not acknowledged yet. */
export interface MirroredAnswer {
  questionId: string;
  response: string;
  at?: number;
  editedAt?: number;
  accountId?: string;
}

export interface PendingAnswersReadResult {
  ok: boolean;
  answers: MirroredAnswer[];
  error?: string;
}

/**
 * Read mirrored (not yet acknowledged) answers with explicit read-failure detection,
 * so a storage read failure never masquerades as empty data.
 */
export async function readPendingAnswersStrict(
  attemptId: string,
  accountId?: string | null,
): Promise<PendingAnswersReadResult> {
  const listed = await offlineListStrict(answersNamespace(attemptId));
  const out: MirroredAnswer[] = [];
  for (const entry of listed.entries) {
    try {
      const parsed = JSON.parse(entry.value) as Partial<MirroredAnswer>;
      if (typeof parsed?.questionId !== 'string' || typeof parsed.response !== 'string') continue;
      if (accountId && parsed.accountId && parsed.accountId !== accountId) continue;
      out.push({
        questionId: parsed.questionId,
        response: parsed.response,
        ...(typeof parsed.at === 'number' ? { at: parsed.at } : {}),
        ...(typeof parsed.editedAt === 'number' ? { editedAt: parsed.editedAt } : {}),
        ...(typeof parsed.accountId === 'string' ? { accountId: parsed.accountId } : {}),
      });
    } catch {
      /* a corrupt mirror entry must never break the restore path */
    }
  }
  out.sort((a, b) => (a.at ?? 0) - (b.at ?? 0));
  return { ok: listed.ok, answers: out, ...(listed.error ? { error: listed.error } : {}) };
}

/**
 * The mirrored (not yet acknowledged) answers, oldest write first.
 */
export async function readPendingAnswers(attemptId: string, accountId?: string | null): Promise<MirroredAnswer[]> {
  return (await readPendingAnswersStrict(attemptId, accountId)).answers;
}

/** How many locally mirrored answers have not been acknowledged yet. */
export async function pendingAnswerCount(attemptId: string): Promise<number> {
  return (await offlineListStrict(answersNamespace(attemptId))).entries.length;
}

/** Drop exactly the answers the server acknowledged; returns how many went. */
export async function resolvePendingAnswers(
  attemptId: string,
  acknowledged: Array<{ questionId: string; response: string }>,
): Promise<number> {
  const synced = new Map(acknowledged.map(answer => [answer.questionId, answer.response]));
  // A fast server acknowledgement can arrive before the async local mirror
  // commits. Wait for writes already queued for the acknowledged questions,
  // then compare-and-delete only the exact value the server accepted.
  await Promise.all([...synced.keys()].map(questionId =>
    answerWrites.get(`${attemptId}:${questionId}`)?.catch(() => false),
  ));
  const pending = (await offlineListStrict(answersNamespace(attemptId))).entries;
  let removed = 0;
  for (const entry of pending) {
    if (!synced.has(entry.key)) continue;
    try {
      const current = JSON.parse(entry.value) as MirroredAnswer;
      if (current.response !== synced.get(entry.key)) continue;
      if (await offlineDeleteIfValue(answersNamespace(attemptId), entry.key, entry.value)) removed++;
    } catch { /* keep unreadable entries rather than delete unacknowledged data */ }
  }
  return removed;
}

/**
 * Preserve recoverable evidence for answers rejected after an authoritative
 * server deadline expired, without modifying or overriding the server deadline.
 */
export async function recordUnacceptedAnswers(
  attemptId: string,
  items: Array<{ questionId: string; response: string }>,
  reason: string,
): Promise<boolean> {
  if (items.length === 0) return true;
  const payload = JSON.stringify({
    attemptId,
    reason,
    recordedAt: Date.now(),
    answers: items,
  });
  const res = await offlinePutDurable(UNACCEPTED_NAMESPACE, attemptId, payload);
  return res.ok;
}

export interface UnacceptedEvidence {
  attemptId: string;
  reason: string;
  recordedAt: number;
  answers: Array<{ questionId: string; response: string }>;
}

export async function readUnacceptedAnswers(attemptId: string): Promise<UnacceptedEvidence | null> {
  try {
    const raw = await offlineGet(UNACCEPTED_NAMESPACE, attemptId);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<UnacceptedEvidence>;
    if (!Array.isArray(parsed?.answers)) return null;
    return {
      attemptId,
      reason: typeof parsed.reason === 'string' ? parsed.reason : 'DEADLINE_EXPIRED',
      recordedAt: typeof parsed.recordedAt === 'number' ? parsed.recordedAt : 0,
      answers: parsed.answers.filter(
        (a): a is { questionId: string; response: string } =>
          Boolean(a && typeof a.questionId === 'string' && typeof a.response === 'string'),
      ),
    };
  } catch {
    return null;
  }
}

/** Cache the remaining timer seconds locally for an attempt. */
export async function cacheTimerSeconds(attemptId: string, seconds: number): Promise<boolean> {
  try {
    return await offlinePut(TIMER_NAMESPACE, attemptId, JSON.stringify({ attemptId, seconds, at: Date.now() }));
  } catch {
    return false;
  }
}

/** Read the locally cached timer seconds, or null if none stored. */
export async function readCachedTimerSeconds(attemptId: string): Promise<number | null> {
  try {
    const raw = await offlineGet(TIMER_NAMESPACE, attemptId);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<{ seconds: number }>;
    return typeof parsed?.seconds === 'number' && Number.isFinite(parsed.seconds) ? parsed.seconds : null;
  } catch {
    return null;
  }
}

/**
 * Flush all pending offline answers for this attempt in bulk.
 * Returns the count of answers successfully synchronized.
 */
export async function flushOfflineSyncQueue(
  attemptId: string,
  sendBulk: (answers: Array<{ questionId: string; response: string }>) => Promise<void>,
): Promise<number> {
  const pending = await readPendingAnswers(attemptId);
  if (pending.length === 0) return 0;
  const payload = pending.map((item) => ({ questionId: item.questionId, response: item.response }));
  await sendBulk(payload);
  await resolvePendingAnswers(attemptId, payload);
  return payload.length;
}

/** Forget everything cached for a finished attempt. */
export async function clearAttemptCache(attemptId: string): Promise<void> {
  await offlineDelete(EXAM_NAMESPACE, attemptId).catch(() => false);
  await offlineDelete(TIMER_NAMESPACE, attemptId).catch(() => false);
  await offlinePurge(answersNamespace(attemptId)).catch(() => undefined);
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.removeItem(`examui.queue.${attemptId}`);
      const essayPrefix = `examui.essay.${attemptId}.`;
      const marksPrefix = `examui.marks.`;
      const keys: string[] = [];
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k) keys.push(k);
      }
      for (const k of keys) {
        if (k.startsWith(essayPrefix) || (k.startsWith(marksPrefix) && k.includes(`.${attemptId}`))) {
          localStorage.removeItem(k);
        }
      }
    }
  } catch {
    /* ignore */
  }
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
