import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  acknowledgeMutations,
  downloadVocabularyForOffline,
  enqueueFlashcardMutation,
  getOfflineProgress,
  getOfflineSnapshot,
  getPendingMutations,
  getUserOfflineVocabularyOverview,
  purgeAccountOfflineVocabulary,
  saveOfflineProgress,
  saveOfflineSnapshot,
  syncAllUserOfflineVocabulary,
  syncOfflineFlashcards,
} from "./offline-vocabulary";
import * as api from "./api";
import { offlinePut } from "./offline-store";
const session = vi.hoisted(() => ({ account: "user-alice" }));
vi.mock("./session-store", () => ({
  useSessionStore: { getState: () => ({ profile: { id: session.account }, accessToken: "test-token" }) },
}));
import type { VocabularyCard } from "./group-contract.generated";

vi.mock("./api", () => ({
  get: vi.fn(),
  patch: vi.fn(),
  post: vi.fn(),
}));

describe("offline-vocabulary", () => {
  const user1 = "user-alice";
  const user2 = "user-bob";
  const assignmentId = "assign-101";

  const sampleWords: VocabularyCard[] = [
    { id: "w1", english: "apple", uzbek: "olma", contextSentence: null, partOfSpeech: null },
    { id: "w2", english: "banana", uzbek: "banan", contextSentence: null, partOfSpeech: null },
    { id: "w3", english: "cherry", uzbek: "olcha", contextSentence: null, partOfSpeech: null },
  ];

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.stubGlobal("navigator", undefined);
    session.account = user1;
    const entries = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      get length() { return entries.size; },
      key: (index: number) => [...entries.keys()][index] ?? null,
      getItem: (key: string) => entries.get(key) ?? null,
      setItem: (key: string, value: string) => entries.set(key, value),
      removeItem: (key: string) => entries.delete(key),
    });
    await purgeAccountOfflineVocabulary(user1, [assignmentId]);
    await purgeAccountOfflineVocabulary(user2, [assignmentId]);
  });

  afterEach(() => vi.unstubAllGlobals());

  it("isolates local data strictly by authenticated user account", async () => {
    await saveOfflineProgress(user1, assignmentId, {
      lastWordId: "w1",
      familiarity: { w1: "known" },
      order: ["w1", "w2", "w3"],
      lastStudiedAt: "2026-11-19T10:00:00Z",
    });

    const aliceProgress = await getOfflineProgress(user1, assignmentId);
    expect(aliceProgress).not.toBeNull();
    expect(aliceProgress?.lastWordId).toBe("w1");
    expect(aliceProgress?.familiarity.w1).toBe("known");

    // Bob cannot see Alice's study progress
    const bobProgress = await getOfflineProgress(user2, assignmentId);
    expect(bobProgress).toBeNull();
  });

  it("saves and retrieves offline collection snapshot durably", async () => {
    await saveOfflineSnapshot(user1, assignmentId, {
      assignmentId,
      revision: 2,
      title: "Essential Verbs",
      level: "B1",
      words: sampleWords,
      downloadedAt: "2026-11-19T12:00:00Z",
    });

    const snapshot = await getOfflineSnapshot(user1, assignmentId);
    expect(snapshot).not.toBeNull();
    expect(snapshot?.revision).toBe(2);
    expect(snapshot?.title).toBe("Essential Verbs");
    expect(snapshot?.words.length).toBe(3);
    expect(snapshot?.words[0].english).toBe("apple");
  });

  it("enqueues flashcard mutations and preserves progress locally", async () => {
    // Initial progress
    await saveOfflineProgress(user1, assignmentId, {
      lastWordId: "w1",
      familiarity: {},
      order: ["w1", "w2", "w3"],
      lastStudiedAt: null,
    });

    // Mark w1 as known offline
    const mut1 = await enqueueFlashcardMutation(user1, assignmentId, {
      wordId: "w1",
      status: "known",
      lastWordId: "w2",
    });

    expect(mut1.opId).toBeDefined();
    expect(mut1.wordId).toBe("w1");
    expect(mut1.status).toBe("known");

    // Local progress is updated immediately
    const progress = await getOfflineProgress(user1, assignmentId);
    expect(progress?.lastWordId).toBe("w2");
    expect(progress?.familiarity.w1).toBe("known");

    // Mutation is queued
    const pending = await getPendingMutations(user1, assignmentId);
    expect(pending.length).toBe(1);
    expect(pending[0].opId).toBe(mut1.opId);

    // Enqueue second mutation (shuffle order)
    const mut2 = await enqueueFlashcardMutation(user1, assignmentId, {
      order: ["w3", "w2", "w1"],
      lastWordId: "w3",
    });

    const pending2 = await getPendingMutations(user1, assignmentId);
    expect(pending2.length).toBe(2);
    expect(pending2[1].opId).toBe(mut2.opId);

    const progress2 = await getOfflineProgress(user1, assignmentId);
    expect(progress2?.order).toEqual(["w3", "w2", "w1"]);
    expect(progress2?.lastWordId).toBe("w3");
  });

  it("acknowledges mutations and removes them from the pending queue", async () => {
    const mut1 = await enqueueFlashcardMutation(user1, assignmentId, {
      wordId: "w1",
      status: "known",
    });
    const mut2 = await enqueueFlashcardMutation(user1, assignmentId, {
      wordId: "w2",
      status: "practice",
    });

    const pendingBefore = await getPendingMutations(user1, assignmentId);
    expect(pendingBefore.length).toBe(2);

    const removed = await acknowledgeMutations(user1, assignmentId, [mut1.opId]);
    expect(removed).toBe(1);

    const pendingAfter = await getPendingMutations(user1, assignmentId);
    expect(pendingAfter.length).toBe(1);
    expect(pendingAfter[0].opId).toBe(mut2.opId);
  });

  it("syncs offline flashcards when online and reconciles server response", async () => {
    const mut = await enqueueFlashcardMutation(user1, assignmentId, {
      wordId: "w1",
      status: "known",
      lastWordId: "w2",
    });

    vi.mocked(api.post).mockResolvedValueOnce({
      lastWordId: "w2",
      familiarity: { w1: "known" },
      order: ["w1", "w2", "w3"],
      lastStudiedAt: "2026-11-19T14:00:00Z",
      acknowledgedOpIds: [mut.opId],
      serverRevision: 1,
    });

    const result = await syncOfflineFlashcards(user1, assignmentId);
    expect(result.success).toBe(true);
    expect(result.acknowledgedCount).toBe(1);
    expect(result.remainingCount).toBe(0);

    const pending = await getPendingMutations(user1, assignmentId);
    expect(pending.length).toBe(0);

    const updated = await getOfflineProgress(user1, assignmentId);
    expect(updated?.familiarity.w1).toBe("known");
    expect(updated?.serverRevision).toBe(1);
  });

  it("handles offline sync failure gracefully without losing queued mutations", async () => {
    await enqueueFlashcardMutation(user1, assignmentId, {
      wordId: "w1",
      status: "known",
    });

    vi.mocked(api.post).mockRejectedValueOnce(new Error("Network offline"));

    const result = await syncOfflineFlashcards(user1, assignmentId);
    expect(result.success).toBe(false);
    expect(result.remainingCount).toBe(1);

    // Queue remains intact
    const pending = await getPendingMutations(user1, assignmentId);
    expect(pending.length).toBe(1);
  });

  it("downloads vocabulary for offline study and seeds local store", async () => {
    vi.mocked(api.get).mockImplementation(async (path: string) => {
      if (path.includes("/snapshot")) {
        return {
          revision: 3,
          title: "IELTS Core",
          level: "C1",
          words: sampleWords,
        };
      }
      if (path.includes("/flashcards")) {
        return {
          lastWordId: "w1",
          familiarity: { w1: "known" },
          order: ["w1", "w2", "w3"],
          lastStudiedAt: "2026-11-19T10:00:00Z",
        };
      }
      return sampleWords;
    });

    const snapshot = await downloadVocabularyForOffline(user1, assignmentId);
    expect(snapshot.title).toBe("IELTS Core");
    expect(snapshot.words.length).toBe(3);

    const localSnap = await getOfflineSnapshot(user1, assignmentId);
    expect(localSnap).not.toBeNull();
    expect(localSnap?.revision).toBe(3);

    const localProgress = await getOfflineProgress(user1, assignmentId);
    expect(localProgress?.familiarity.w1).toBe("known");
  });

  it("aggregates user offline vocabulary overview across assignments and syncs batch", async () => {
    const assign2 = "assign-202";
    await purgeAccountOfflineVocabulary(user1, [assign2]);

    // Save snapshots for two assignments
    await saveOfflineSnapshot(user1, assignmentId, {
      assignmentId,
      revision: 1,
      title: "Set 1",
      words: sampleWords,
      downloadedAt: "2026-11-19T10:00:00Z",
    });

    await saveOfflineSnapshot(user1, assign2, {
      assignmentId: assign2,
      revision: 1,
      title: "Set 2",
      words: [{ id: "w4", english: "date", uzbek: "xurmo", contextSentence: null, partOfSpeech: null }],
      downloadedAt: "2026-11-19T12:00:00Z",
    });

    // Enqueue pending mutation on assign2
    const mut = await enqueueFlashcardMutation(user1, assign2, {
      wordId: "w4",
      status: "known",
    });

    const overview = await getUserOfflineVocabularyOverview(user1);
    expect(overview.collectionCount).toBe(2);
    expect(overview.totalWords).toBe(4);
    expect(overview.pendingMutationsCount).toBe(1);
    expect(overview.lastDownloadedAt).toBe("2026-11-19T12:00:00Z");
    expect(overview.assignmentIds).toContain(assignmentId);
    expect(overview.assignmentIds).toContain(assign2);

    // Sync all
    vi.mocked(api.post).mockResolvedValueOnce({
      lastWordId: "w4",
      familiarity: { w4: "known" },
      order: ["w4"],
      lastStudiedAt: "2026-11-19T14:00:00Z",
      acknowledgedOpIds: [mut.opId],
      serverRevision: 1,
    });

    const syncRes = await syncAllUserOfflineVocabulary(user1);
    expect(syncRes.success).toBe(true);
    expect(syncRes.totalAcknowledged).toBe(1);
    expect(syncRes.totalRemaining).toBe(0);

    const overviewAfter = await getUserOfflineVocabularyOverview(user1);
    expect(overviewAfter.pendingMutationsCount).toBe(0);

    await purgeAccountOfflineVocabulary(user1, [assign2]);
  });
  it("fails visibly when durable storage is absent or rejects a write", async () => {
    vi.stubGlobal("localStorage", undefined);
    await expect(enqueueFlashcardMutation(user1, assignmentId, { lastWordId: "w1" })).rejects.toThrow("unavailable");
    expect(await getPendingMutations(user1, assignmentId)).toEqual([]);
    vi.stubGlobal("localStorage", {
      getItem: () => null,
      setItem: () => { throw new Error("Quota exceeded"); },
    });
    await expect(enqueueFlashcardMutation(user1, assignmentId, { lastWordId: "w1" })).rejects.toThrow("Quota exceeded");
    expect(await getOfflineProgress(user1, assignmentId)).toBeNull();
  });

  it("keeps simultaneous edits and refuses to overwrite a corrupt upgrade queue", async () => {
    const writes = await Promise.all(sampleWords.map(({ id }) =>
      enqueueFlashcardMutation(user1, assignmentId, { wordId: id, status: "known" })));
    expect(await getPendingMutations(user1, assignmentId)).toEqual(writes);
    expect(await getOfflineProgress(user1, assignmentId)).toMatchObject({
      familiarity: { w1: "known", w2: "known", w3: "known" },
    });
    await offlinePut("vocab." + user1 + ".broken", "pending_mutations", "invalid json");
    await expect(enqueueFlashcardMutation(user1, "broken", { lastWordId: "w1" })).rejects.toThrow();
  });

  it("retains changes on missing acknowledgement and keeps edits made while a request is in flight", async () => {
    const first = await enqueueFlashcardMutation(user1, assignmentId, { wordId: "w1", status: "known" });
    const response = { lastWordId: "w1", familiarity: { w1: "known" }, order: [], lastStudiedAt: null };
    vi.mocked(api.post).mockResolvedValueOnce(response);
    expect(await syncOfflineFlashcards(user1, assignmentId)).toMatchObject({ success: false, remainingCount: 1 });
    expect(api.patch).not.toHaveBeenCalled();
    vi.mocked(api.post).mockImplementationOnce(async () => {
      await enqueueFlashcardMutation(user1, assignmentId, { lastWordId: "w2" });
      return { ...response, acknowledgedOpIds: [first.opId], serverRevision: 1 };
    });
    expect(await syncOfflineFlashcards(user1, assignmentId)).toMatchObject({ success: true, remainingCount: 1 });
    expect(await getOfflineProgress(user1, assignmentId)).toMatchObject({ lastWordId: "w2" });
    expect(await getPendingMutations(user1, assignmentId)).toMatchObject([{ lastWordId: "w2" }]);
  });

  it("clears all cached vocabulary for one account on logout", async () => {
    await enqueueFlashcardMutation(user1, assignmentId, { lastWordId: "w1" });
    session.account = user2;
    await enqueueFlashcardMutation(user2, assignmentId, { lastWordId: "w2" });
    await purgeAccountOfflineVocabulary(user1);
    expect(await getPendingMutations(user1, assignmentId)).toEqual([]);
    expect(await getPendingMutations(user2, assignmentId)).toMatchObject([{ lastWordId: "w2" }]);
  });

});
