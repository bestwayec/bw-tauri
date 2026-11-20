/**
 * Account-isolated offline vocabulary and flashcard persistence.
 *
 * Requirements:
 * - Isolated by authenticated user ID (never leaks between accounts).
 * - Persists downloaded vocabulary collection snapshots durably in IndexedDB.
 * - Allows offline flashcard study (flipping, stepping, marking known/practice, shuffling).
 * - Preserves study position and card familiarity across app restarts.
 * - Enqueues mutations durably with stable opIds.
 * - Syncs pending mutations when online and reconciles with server acknowledgements.
 * - Strictly avoids storing auth/refresh tokens in offline study storage.
 */
import { offlineGet, offlineList, purgeDurableOfflinePrefix, updateDurableOfflineValue } from "./offline-store";
import { get, patch, post } from "./api";
import { useSessionStore } from "./session-store";
import type {
  VocabularyCard,
  VocabularyCollectionSnapshot,
  VocabularyFlashcardMutation,
  VocabularyFlashcards,
} from "./group-contract.generated";

export interface OfflineVocabularySnapshot {
  assignmentId: string;
  revision: number;
  title: string;
  level?: string;
  words: VocabularyCard[];
  downloadedAt: string;
}

export interface OfflineFlashcardState {
  lastWordId: string;
  familiarity: Record<string, "known" | "practice">;
  order: string[];
  lastStudiedAt: string | null;
  serverRevision?: number;
}

export interface VocabularySyncResult {
  success: boolean;
  acknowledgedCount: number;
  remainingCount: number;
  error?: string;
}

function accountNamespace(userId: string): string {
  return "vocab." + encodeURIComponent(userId.trim()).replace(/\./g, "%2E");
}

function vocabNamespace(userId: string, assignmentId: string): string {
  const safeAssignment = encodeURIComponent(assignmentId.trim());
  return accountNamespace(userId) + "." + safeAssignment;
}

function generateOpId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `op_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

interface StudyState {
  snapshot: OfflineVocabularySnapshot | null;
  progress: OfflineFlashcardState | null;
  pending: VocabularyFlashcardMutation[];
}

const stateKey = "study_state";

function readQueue(raw: string | null): VocabularyFlashcardMutation[] {
  if (!raw) return [];
  const queue: unknown = JSON.parse(raw);
  if (!Array.isArray(queue) || queue.some((op) => !op || typeof op.opId !== "string" || !op.opId)
    || new Set(queue.map((op) => op.opId)).size !== queue.length) {
    throw new Error("Offline vocabulary queue is damaged");
  }
  return queue;
}

function parseState(raw: string): StudyState {
  const state = JSON.parse(raw) as StudyState;
  if (!state || !Array.isArray(state.pending)) throw new Error("Offline vocabulary state is damaged");
  state.pending = readQueue(JSON.stringify(state.pending));
  return state;
}

async function readStudyState(ns: string): Promise<StudyState> {
  const raw = await offlineGet(ns, stateKey);
  if (raw !== null) return parseState(raw);
  // Preserve previously downloaded snapshots and pending changes on upgrade.
  const [snapshot, progress, pending] = await Promise.all([
    offlineGet(ns, "snapshot"), offlineGet(ns, "progress"), offlineGet(ns, "pending_mutations"),
  ]);
  return { snapshot: snapshot ? JSON.parse(snapshot) : null, progress: progress ? JSON.parse(progress) : null,
    pending: readQueue(pending) };
}

async function updateStudyState<T>(
  userId: string, assignmentId: string, change: (state: StudyState) => T,
): Promise<T> {
  if (!userId.trim() || !assignmentId.trim()) throw new Error("An account and assignment are required");
  const ns = vocabNamespace(userId, assignmentId);
  const initial = await readStudyState(ns);
  return updateDurableOfflineValue(ns, stateKey, (raw) => {
    const state = raw === null ? initial : parseState(raw);
    const result = change(state);
    return { value: JSON.stringify(state), result };
  });
}

export async function saveOfflineSnapshot(
  userId: string, assignmentId: string, snapshot: OfflineVocabularySnapshot,
): Promise<boolean> {
  await updateStudyState(userId, assignmentId, (state) => { state.snapshot = snapshot; });
  return true;
}

export async function getOfflineSnapshot(userId: string, assignmentId: string) {
  return (await readStudyState(vocabNamespace(userId, assignmentId))).snapshot;
}

export async function saveOfflineProgress(
  userId: string, assignmentId: string, progress: OfflineFlashcardState,
): Promise<boolean> {
  await updateStudyState(userId, assignmentId, (state) => { state.progress = progress; });
  return true;
}

export async function getOfflineProgress(userId: string, assignmentId: string) {
  return (await readStudyState(vocabNamespace(userId, assignmentId))).progress;
}

export async function getPendingMutations(userId: string, assignmentId: string) {
  return (await readStudyState(vocabNamespace(userId, assignmentId))).pending;
}

function applyChange(
  progress: OfflineFlashcardState | null, mutation: VocabularyFlashcardMutation,
): OfflineFlashcardState {
  const familiarity = { ...progress?.familiarity };
  if (mutation.wordId && mutation.status) familiarity[mutation.wordId] = mutation.status;
  return {
    lastWordId: mutation.lastWordId ?? progress?.lastWordId ?? "",
    familiarity,
    order: mutation.order ?? progress?.order ?? [],
    lastStudiedAt: mutation.timestamp ?? progress?.lastStudiedAt ?? null,
    serverRevision: progress?.serverRevision,
  };
}

export async function enqueueFlashcardMutation(
  userId: string, assignmentId: string, change: Omit<VocabularyFlashcardMutation, "opId" | "timestamp">,
  baseline?: OfflineFlashcardState,
): Promise<VocabularyFlashcardMutation> {
  const mutation = { ...change, opId: generateOpId(), timestamp: new Date().toISOString() };
  await updateStudyState(userId, assignmentId, (state) => {
    assertStudyAccount(userId);
    state.pending.push(mutation);
    state.progress = applyChange(state.progress ?? baseline ?? null, mutation);
  });
  return mutation;
}

export function acknowledgeMutations(userId: string, assignmentId: string, acknowledgedOpIds: string[]) {
  const acknowledged = new Set(acknowledgedOpIds);
  return updateStudyState(userId, assignmentId, (state) => {
    const count = state.pending.length;
    state.pending = state.pending.filter((op) => !acknowledged.has(op.opId));
    return count - state.pending.length;
  });
}

export async function purgeAccountOfflineVocabulary(userId: string, assignmentIds?: string[]): Promise<void> {
  if (!userId.trim()) return;
  if (assignmentIds) {
    await Promise.all(assignmentIds.map((id) => purgeDurableOfflinePrefix(vocabNamespace(userId, id))));
  } else {
    await purgeDurableOfflinePrefix(accountNamespace(userId));
  }
}

function assertStudyAccount(userId: string) {
  const { profile, accessToken } = useSessionStore.getState();
  if (profile?.id !== userId) throw new Error("Vocabulary session has changed");
  return accessToken;
}

async function accountRequest<T>(userId: string, send: (token: string) => Promise<T>): Promise<T> {
  const token = assertStudyAccount(userId);
  if (!token) throw new Error("Vocabulary session is unavailable");
  try {
    return await send(token);
  } catch (error) {
    if (error && typeof error === "object" && "status" in error && error.status === 401) {
      assertStudyAccount(userId);
      await useSessionStore.getState().refreshNow();
      const fresh = assertStudyAccount(userId);
      if (fresh) return send(fresh);
    }
    throw error;
  }
}

function serverProgress(response: VocabularyFlashcards): OfflineFlashcardState {
  return {
    lastWordId: response.lastWordId,
    familiarity: response.familiarity,
    order: response.order,
    lastStudiedAt: response.lastStudiedAt,
    serverRevision: response.serverRevision,
  };
}

export async function syncOfflineFlashcards(
  userId: string, assignmentId: string,
): Promise<VocabularySyncResult> {
  const pending = await getPendingMutations(userId, assignmentId);
  if (!pending.length) return { success: true, acknowledgedCount: 0, remainingCount: 0 };
  const batch = pending.slice(0, 100);
  const operationIds = new Set(batch.map((op) => op.opId));
  const root = "/v1/student/assignments/" + encodeURIComponent(assignmentId) + "/vocabulary";
  try {
    const response = await accountRequest(userId, (token) => post<VocabularyFlashcards>(root + "/flashcards/sync", { mutations: batch }, { token }));
    if (!Array.isArray(response.acknowledgedOpIds) || !response.acknowledgedOpIds.length
      || response.acknowledgedOpIds.some((id) => !operationIds.has(id))) {
      throw new Error("Server did not acknowledge the submitted vocabulary operations");
    }
    const acknowledged = new Set(response.acknowledgedOpIds);
    return await updateStudyState(userId, assignmentId, (state) => {
      assertStudyAccount(userId);
      const before = state.pending.length;
      state.pending = state.pending.filter((op) => !acknowledged.has(op.opId));
      if ((response.serverRevision ?? 0) >= (state.progress?.serverRevision ?? 0)) {
        state.progress = state.pending.reduce(applyChange, serverProgress(response));
      }
      return { success: true, acknowledgedCount: before - state.pending.length, remainingCount: state.pending.length };
    });
  } catch (error) {
    const message = error && typeof error === "object" && "message" in error ? String(error.message) : "Sync failed";
    return { success: false, acknowledgedCount: 0, remainingCount: pending.length, error: message };
  }
}

export function saveOnlineFlashcardChange(
  userId: string, assignmentId: string, change: Omit<VocabularyFlashcardMutation, "opId" | "timestamp">,
) {
  const endpoint = "/v1/student/assignments/" + encodeURIComponent(assignmentId) + "/vocabulary/flashcards";
  return accountRequest(userId, (token) => patch<VocabularyFlashcards>(endpoint, change, { token }));
}

export async function downloadVocabularyForOffline(
  userId: string, assignmentId: string,
): Promise<OfflineVocabularySnapshot> {
  const root = "/v1/student/assignments/" + encodeURIComponent(assignmentId) + "/vocabulary";
  const [source, progress] = await accountRequest(userId, (token) => Promise.all([
    get<VocabularyCollectionSnapshot>(root + "/snapshot", undefined, { token }),
    get<VocabularyFlashcards>(root + "/flashcards", undefined, { token }),
  ]));
  const snapshot = { assignmentId, revision: source.revision, title: source.title, level: source.level,
    words: source.words, downloadedAt: new Date().toISOString() };
  await updateStudyState(userId, assignmentId, (state) => {
    assertStudyAccount(userId);
    state.snapshot = snapshot;
    if (!state.pending.length && (progress.serverRevision ?? 0) >= (state.progress?.serverRevision ?? 0)) {
      state.progress = serverProgress(progress);
    }
  });
  return snapshot;
}

export async function listOfflineSnapshots(userId: string): Promise<OfflineVocabularySnapshot[]> {
  const { assignmentIds } = await getUserOfflineVocabularyOverview(userId);
  const snapshots = await Promise.all(assignmentIds.map((id) => getOfflineSnapshot(userId, id)));
  return snapshots.filter((snapshot) => snapshot !== null);
}

export async function removeOfflineSnapshot(userId: string, assignmentId: string): Promise<void> {
  await updateStudyState(userId, assignmentId, (state) => {
    state.snapshot = null;
  });
}

export interface OfflineVocabularyOverview {
  collectionCount: number;
  totalWords: number;
  pendingMutationsCount: number;
  lastDownloadedAt: string | null;
  lastStudiedAt: string | null;
  assignmentIds: string[];
}

export interface BatchSyncResult {
  success: boolean;
  totalAcknowledged: number;
  totalRemaining: number;
  errors: string[];
}

/**
 * Aggregates offline vocabulary status for a user across all stored assignments.
 * Inspects snapshots, progress, and pending mutation queues.
 */
export async function getUserOfflineVocabularyOverview(
  userId: string,
): Promise<OfflineVocabularyOverview> {
  const records = await offlineList(accountNamespace(userId));

  const ids = new Set(records.map(({ key }) => decodeURIComponent(key.slice(0, key.lastIndexOf(".")))));
  const overview: OfflineVocabularyOverview = {
    collectionCount: 0, totalWords: 0, pendingMutationsCount: 0,
    lastDownloadedAt: null, lastStudiedAt: null, assignmentIds: [],
  };
  for (const id of ids) {
    const { snapshot, progress, pending } = await readStudyState(vocabNamespace(userId, id));
    if (snapshot || pending.length) overview.assignmentIds.push(id);
    if (snapshot) {
      overview.collectionCount++;
      overview.totalWords += snapshot.words.length;
      if (!overview.lastDownloadedAt || snapshot.downloadedAt > overview.lastDownloadedAt) {
        overview.lastDownloadedAt = snapshot.downloadedAt;
      }
    }
    overview.pendingMutationsCount += pending.length;
    if (progress?.lastStudiedAt && (!overview.lastStudiedAt || progress.lastStudiedAt > overview.lastStudiedAt)) {
      overview.lastStudiedAt = progress.lastStudiedAt;
    }
  }
  return overview;
}

/**
 * Synchronizes all pending mutations for all assignments belonging to the user.
 */
export async function syncAllUserOfflineVocabulary(
  userId: string,
): Promise<BatchSyncResult> {
  const overview = await getUserOfflineVocabularyOverview(userId);
  let totalAcknowledged = 0;
  let totalRemaining = 0;
  const errors: string[] = [];

  for (const assignmentId of overview.assignmentIds) {
    const pending = await getPendingMutations(userId, assignmentId);
    if (pending.length === 0) continue;

    const res = await syncOfflineFlashcards(userId, assignmentId);
    totalAcknowledged += res.acknowledgedCount;
    totalRemaining += res.remainingCount;
    if (!res.success && res.error) {
      errors.push(`${assignmentId}: ${res.error}`);
    }
  }

  return {
    success: errors.length === 0,
    totalAcknowledged,
    totalRemaining,
    errors,
  };
}
