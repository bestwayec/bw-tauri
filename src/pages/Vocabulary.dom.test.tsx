// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import Vocabulary from "./Vocabulary";
import { get } from "../lib/api";
import { enqueueFlashcardMutation } from "../lib/offline-vocabulary";
import { setAppLanguage } from "../lib/ui-prefs";

vi.mock("../lib/api", () => ({ get: vi.fn(), post: vi.fn() }));
vi.mock("../lib/offline-vocabulary", () => ({
  downloadVocabularyForOffline: vi.fn(),
  enqueueFlashcardMutation: vi.fn(async () => undefined),
  getOfflineProgress: vi.fn(async () => null),
  getOfflineSnapshot: vi.fn(async () => null),
  getPendingMutations: vi.fn(async () => []),
  listOfflineSnapshots: vi.fn(async () => []),
  removeOfflineSnapshot: vi.fn(async () => undefined),
  saveOnlineFlashcardChange: vi.fn(),
  syncOfflineFlashcards: vi.fn(async () => ({ success: true, acknowledgedCount: 0, remainingCount: 0 })),
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const words = [
  { id: "w1", english: "resilient", uzbek: "chidamli", partOfSpeech: "adj" },
  { id: "w2", english: "environment", uzbek: "atrof-muhit" },
];

let host: HTMLDivElement;
let root: Root;

async function renderPage() {
  vi.mocked(get).mockImplementation(async (path: string) => {
    if (path === "/v1/student/my-assignments") return [{ id: "a1", title: "Unit 1", vocabulary_set_id: "s1", score_percent: null, deadline: "2026-12-01T10:00:00Z" }];
    if (path.endsWith("/words")) return words;
    if (path.endsWith("/flashcards")) return { lastWordId: "w1", familiarity: { w2: "known" }, order: ["w1", "w2"], lastStudiedAt: null };
    return { entries: [], hasNext: false };
  });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  await act(async () => {
    root.render(<QueryClientProvider client={client}><Vocabulary userId="student-1" initialAssignmentId="a1" /></QueryClientProvider>);
  });
  for (let i = 0; i < 5; i += 1) await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
}

beforeEach(() => {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.clearAllMocks();
});

describe("Vocabulary study view", () => {
  it("uses one language at a time and switches with the app setting", async () => {
    setAppLanguage("en");
    await renderPage();
    const english = host.textContent ?? "";
    expect(english).toContain("Flashcards");
    expect(english).toContain("1 / 2 known");
    expect(english).toContain("resilient");
    expect(english).not.toMatch(/Bilaman|Oflayn|Fleshkarta/);
    expect(host.querySelector('[role="progressbar"]')?.getAttribute("aria-valuenow")).toBe("1");

    act(() => setAppLanguage("uz"));
    const uzbek = host.textContent ?? "";
    expect(uzbek).toContain("Fleshkartalar");
    expect(uzbek).toContain("1 / 2 o‘rganildi");
    expect(uzbek).not.toMatch(/Flashcards|I know it|Save offline/);
  });

  it("records 'known' for the current card through the durable offline queue", async () => {
    setAppLanguage("en");
    await renderPage();
    const known = Array.from(host.querySelectorAll("button")).find((b) => b.textContent?.includes("I know it"))!;
    await act(async () => { known.click(); });
    expect(enqueueFlashcardMutation).toHaveBeenCalledWith("student-1", "a1", { wordId: "w1", status: "known", lastWordId: "w1" }, expect.anything());
  });
});
