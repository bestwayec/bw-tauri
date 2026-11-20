import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { StudentOfflineVocabWidget } from "./StudentOfflineVocabWidget";

vi.mock("@/lib/offline-vocabulary", () => ({
  getUserOfflineVocabularyOverview: vi.fn().mockResolvedValue({
    collectionCount: 3,
    totalWords: 45,
    pendingMutationsCount: 2,
    lastDownloadedAt: "2026-11-19T10:00:00Z",
    lastStudiedAt: "2026-11-19T12:00:00Z",
    assignmentIds: ["a1", "a2", "a3"],
  }),
  syncAllUserOfflineVocabulary: vi.fn().mockResolvedValue({
    success: true,
    totalAcknowledged: 2,
    totalRemaining: 0,
    errors: [],
  }),
}));

describe("StudentOfflineVocabWidget", () => {
  it("renders offline study badge and navigation button", () => {
    const onNavigate = vi.fn();
    const html = renderToStaticMarkup(
      <StudentOfflineVocabWidget onNavigate={onNavigate} userId="student-1" />
    );

    expect(html).toContain("Offline Study");
    expect(html).toContain("Lug‘at va Fleshkartalar (IndexedDB)");
    expect(html).toContain("Fleshkartalarni ochish →");
  });
});
