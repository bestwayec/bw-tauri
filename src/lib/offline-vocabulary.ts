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
import { offlineGet, offlinePut, offlinePurge } from "./offline-store";
import { get, patch, post } from "./api";
import type {
  VocabularyCard,
  VocabularyCollectionSnapshot,
  VocabularyFlashcardChange,
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

function vocabNamespace(userId: string, assignmentId: string): string {
  const safeUser = encodeURIComponent(userId.trim() || "anonymous");
  const safeAssignment = encodeURIComponent(assignmentId.trim());
  return `vocab.${safeUser}.${safeAssignment}`;
}

function generateOpId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `op_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

/** Save a downloaded vocabulary snapshot to durable local storage. */
export async function saveOfflineSnapshot(
  userId: string,
  assignmentId: string,
  snapshot: OfflineVocabularySnapshot,
): Promise<boolean> {
  const ns = vocabNamespace(userId, assignmentId);
  return offlinePut(ns, "snapshot", JSON.stringify(snapshot));
}

/** Retrieve the local vocabulary snapshot if downloaded. */
export async function getOfflineSnapshot(
  userId: string,
  assignmentId: string,
): Promise<OfflineVocabularySnapshot | null> {
  const ns = vocabNamespace(userId, assignmentId);
  const raw = await offlineGet(ns, "snapshot");
  if (!raw) return null;
  try {
    return JSON.parse(raw) as OfflineVocabularySnapshot;
  } catch {
    return null;
  }
}

/** Save local flashcard study state. */
export async function saveOfflineProgress(
  userId: string,
  assignmentId: string,
  progress: OfflineFlashcardState,
): Promise<boolean> {
  const ns = vocabNamespace(userId, assignmentId);
  return offlinePut(ns, "progress", JSON.stringify(progress));
}

/** Retrieve local flashcard study state. */
export async function getOfflineProgress(
  userId: string,
  assignmentId: string,
): Promise<OfflineFlashcardState | null> {
  const ns = vocabNamespace(userId, assignmentId);
  const raw = await offlineGet(ns, "progress");
  if (!raw) return null;
  try {
    return JSON.parse(raw) as OfflineFlashcardState;
  } catch {
    return null;
  }
}

/** Retrieve all pending mutations waiting to sync to the server. */
export async function getPendingMutations(
  userId: string,
  assignmentId: string,
): Promise<VocabularyFlashcardMutation[]> {
  const ns = vocabNamespace(userId, assignmentId);
  const raw = await offlineGet(ns, "pending_mutations");
  if (!raw) return [];
  try {
    const list = JSON.parse(raw);
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

/** Record a new flashcard mutation into the durable pending queue. */
export async function enqueueFlashcardMutation(
  userId: string,
  assignmentId: string,
  change: {
    wordId?: string;
    status?: "known" | "practice";
    lastWordId?: string;
    order?: string[];
  },
): Promise<VocabularyFlashcardMutation> {
  const mutation: VocabularyFlashcardMutation = {
    opId: generateOpId(),
    wordId: change.wordId,
    status: change.status,
    lastWordId: change.lastWordId,
    order: change.order,
    timestamp: new Date().toISOString(),
  };

  const existing = await getPendingMutations(userId, assignmentId);
  const updated = [...existing, mutation];
  const ns = vocabNamespace(userId, assignmentId);
  await offlinePut(ns, "pending_mutations", JSON.stringify(updated));

  // Also update local progress snapshot immediately for instant UI and reload survival
  const currentProgress = (await getOfflineProgress(userId, assignmentId)) || {
    lastWordId: "",
    familiarity: {},
    order: [],
    lastStudiedAt: null,
  };

  if (change.lastWordId) currentProgress.lastWordId = change.lastWordId;
  if (change.order) currentProgress.order = change.order;
  if (change.wordId && change.status) {
    currentProgress.familiarity[change.wordId] = change.status;
  }
  currentProgress.lastStudiedAt = mutation.timestamp ?? new Date().toISOString();

  await saveOfflineProgress(userId, assignmentId, currentProgress);
  return mutation;
}

/** Remove acknowledged mutation opIds from the durable pending queue. */
export async function acknowledgeMutations(
  userId: string,
  assignmentId: string,
  acknowledgedOpIds: string[],
): Promise<number> {
  if (!acknowledgedOpIds.length) return 0;
  const ackSet = new Set(acknowledgedOpIds);
  const existing = await getPendingMutations(userId, assignmentId);
  const remaining = existing.filter((op) => !ackSet.has(op.opId));
  const ns = vocabNamespace(userId, assignmentId);
  await offlinePut(ns, "pending_mutations", JSON.stringify(remaining));
  return existing.length - remaining.length;
}

/** Clear all pending mutations and cached data for a specific user upon logout / account switch. */
export async function purgeAccountOfflineVocabulary(
  userId: string,
  assignmentIds: string[] = [],
): Promise<void> {
  for (const id of assignmentIds) {
    const ns = vocabNamespace(userId, id);
    await offlinePurge(ns);
  }
}

/**
 * Synchronize local offline changes with the server.
 * Handles both the dedicated `/sync` endpoint and backward-compatible fallback to `/flashcards`.
 */
export async function syncOfflineFlashcards(
  userId: string,
  assignmentId: string,
): Promise<VocabularySyncResult> {
  const pending = await getPendingMutations(userId, assignmentId);
  const localProgress = await getOfflineProgress(userId, assignmentId);
  const root = `/v1/student/assignments/${encodeURIComponent(assignmentId)}/vocabulary`;

  if (!pending.length) {
    return { success: true, acknowledgedCount: 0, remainingCount: 0 };
  }

  // Cap batch size defensively at 100
  const batch = pending.slice(0, 100);
  const payload: VocabularyFlashcardChange = {
    mutations: batch,
    lastWordId: localProgress?.lastWordId,
    order: localProgress?.order,
  };

  try {
    // Attempt dedicated sync endpoint first
    let response: VocabularyFlashcards;
    try {
      response = await post<VocabularyFlashcards>(`${root}/flashcards/sync`, payload);
    } catch {
      // Fallback to PATCH /flashcards with mutations payload
      response = await patch<VocabularyFlashcards>(`${root}/flashcards`, payload);
    }

    const acknowledged = response.acknowledgedOpIds || batch.map((m) => m.opId);
    const removedCount = await acknowledgeMutations(userId, assignmentId, acknowledged);

    // Save updated server-confirmed state
    if (response) {
      await saveOfflineProgress(userId, assignmentId, {
        lastWordId: response.lastWordId,
        familiarity: response.familiarity,
        order: response.order,
        lastStudiedAt: response.lastStudiedAt,
        serverRevision: response.serverRevision,
      });
    }

    const remaining = await getPendingMutations(userId, assignmentId);
    return {
      success: true,
      acknowledgedCount: removedCount,
      remainingCount: remaining.length,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Sync failed";
    const remaining = await getPendingMutations(userId, assignmentId);
    return {
      success: false,
      acknowledgedCount: 0,
      remainingCount: remaining.length,
      error: message,
    };
  }
}

/**
 * Download collection for offline study.
 * Fetches words snapshot and initial flashcard state, saving them durably.
 */
export async function downloadVocabularyForOffline(
  userId: string,
  assignmentId: string,
): Promise<OfflineVocabularySnapshot> {
  const root = `/v1/student/assignments/${encodeURIComponent(assignmentId)}/vocabulary`;

  let words: VocabularyCard[];
  let revision = 1;
  let title = "Vocabulary Collection";

  try {
    const snap = await get<VocabularyCollectionSnapshot>(`${root}/snapshot`);
    words = snap.words;
    revision = snap.revision;
    title = snap.title;
  } catch {
    words = await get<VocabularyCard[]>(`${root}/words`);
  }

  const snapshot: OfflineVocabularySnapshot = {
    assignmentId,
    revision,
    title,
    words,
    downloadedAt: new Date().toISOString(),
  };

  await saveOfflineSnapshot(userId, assignmentId, snapshot);

  // Also fetch and seed server progress if available
  try {
    const progress = await get<VocabularyFlashcards>(`${root}/flashcards`);
    if (progress) {
      await saveOfflineProgress(userId, assignmentId, {
        lastWordId: progress.lastWordId || (words[0] ? words[0].id : ""),
        familiarity: progress.familiarity || {},
        order: progress.order.length ? progress.order : words.map((w) => w.id),
        lastStudiedAt: progress.lastStudiedAt,
      });
    }
  } catch {
    // If progress cannot be fetched, initialize default local state
    const current = await getOfflineProgress(userId, assignmentId);
    if (!current) {
      await saveOfflineProgress(userId, assignmentId, {
        lastWordId: words[0] ? words[0].id : "",
        familiarity: {},
        order: words.map((w) => w.id),
        lastStudiedAt: null,
      });
    }
  }

  return snapshot;
}
