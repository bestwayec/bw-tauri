import { describe, expect, it, vi } from "vitest";
import { get, post } from "./api";
import {
  listMockExams,
  MOCK_SECTION_MINUTES,
  singleSectionOf,
  startMockExam,
  submitSkillsFor,
  targetSectionOf,
  type MockStartResult,
} from "./mocks";

vi.mock("./api", () => ({ get: vi.fn(), post: vi.fn(), API_BASE_URL: "https://api.example.test/v1" }));

const section = (skill: MockStartResult["exam"]["sections"][number]["skill"]) => ({
  id: `sec-${skill}`,
  skill,
  title: null,
  sortOrder: 0,
  durationMinutes: null,
  instructions: null,
  groups: [],
});

function startResult(over: Partial<MockStartResult> = {}): MockStartResult {
  return {
    attemptId: "attempt-1",
    resumed: false,
    mode: "practice",
    startedAt: "2026-10-15T10:00:00.000Z",
    deadlineAt: null,
    serverTime: "2026-10-15T10:00:00.000Z",
    durationMinutes: null,
    flowMode: "single_skill",
    currentSkill: null,
    sectionDeadlines: null,
    overallDeadlineAt: null,
    exam: {
      id: "mock-1",
      type: "multilevel",
      title: "Full Mock",
      description: null,
      level: null,
      isPublished: true,
      isDemo: false,
      createdAt: "2026-10-01T00:00:00.000Z",
      updatedAt: "2026-10-01T00:00:00.000Z",
      questionCount: 81,
      sections: [section("listening"), section("reading"), section("writing"), section("speaking")],
    },
    annotations: [],
    savedAnswers: {},
    ...over,
  };
}

describe("single-section start", () => {
  it("asks the backend for one section three ways and never for full_test", async () => {
    vi.mocked(post).mockResolvedValueOnce(startResult());
    await startMockExam("mock-1", { mode: "practice", flow: "single_skill", section: "writing" });
    expect(post).toHaveBeenCalledWith("/mock/exams/mock-1/start", {
      mode: "practice",
      flow: "single_skill",
      section: "writing",
      section_filter: "writing",
      skills: ["writing"],
    });
  });

  it("keeps Full Mock free of any section scope", async () => {
    vi.mocked(post).mockResolvedValueOnce(startResult({ flowMode: "full_test", currentSkill: "listening" }));
    await startMockExam("mock-1", { mode: "timed", flow: "full_test" });
    expect(post).toHaveBeenCalledWith("/mock/exams/mock-1/start", { mode: "timed", flow: "full_test" });
  });

  it("submits a scoped attempt without section skills and a multi-section attempt with them", () => {
    const scoped = startResult({ isSingleSection: true, singleSection: "writing" });
    expect(submitSkillsFor(scoped, "writing")).toBeUndefined();
    expect(submitSkillsFor(startResult(), "reading")).toEqual(["reading"]);
  });

  it("finds the section of a scoped attempt even when the backend sends all sections", () => {
    expect(singleSectionOf(startResult({ isSingleSection: true, singleSection: "writing" }))).toBe("writing");
    // No server flag: exactly one section means the attempt is scoped to it.
    const onlyReading = startResult({ exam: { ...startResult().exam, sections: [section("reading")] } });
    expect(singleSectionOf(onlyReading)).toBe("reading");
    // A full mock is never single-section, even if only one section came back.
    expect(singleSectionOf({ ...onlyReading, flowMode: "full_test" })).toBeNull();
  });

  it("routes to the picked section first, then the server scope, then the current skill", () => {
    expect(targetSectionOf(startResult(), "speaking")).toBe("speaking");
    expect(targetSectionOf(startResult({ isSingleSection: true, singleSection: "reading" }), "speaking")).toBe(
      "reading",
    );
    expect(targetSectionOf(startResult({ flowMode: "full_test", currentSkill: "writing" }))).toBe("writing");
    // Nothing resolvable (multi-skill partial practice) falls through to the picker page.
    expect(targetSectionOf(startResult())).toBeNull();
  });

  it("publishes the practice durations shown on the picker", () => {
    expect(MOCK_SECTION_MINUTES).toEqual({ listening: 35, reading: 60, writing: 60, speaking: 15 });
  });
});

describe("listMockExams schema resilience & raw fallback", () => {
  it("accepts writing_speaking, diagnostic, section, and custom profile values without SCHEMA_MISMATCH", async () => {
    vi.mocked(get).mockResolvedValueOnce([
      {
        id: "exam-ws",
        type: "multilevel",
        profile: "writing_speaking",
        title: "Writing + Speaking Essentials (B2)",
        description: null,
        level: "B2",
        practiceLevel: "B2",
        isDemo: false,
        isPublished: true,
        ready: true,
        skills: ["writing", "speaking"],
        questionCount: 2,
        durationMinutes: 75,
        price: 0,
        access: "granted",
      },
      {
        id: "exam-diag",
        type: "ielts_academic",
        profile: "diagnostic",
        track: "IELTS",
        status: "published",
        difficulty: "hard",
        target_level: "C1",
        title: "Diagnostic IELTS",
        description: null,
        level: "C1",
        isDemo: true,
        isPublished: true,
        skills: ["reading"],
        questionCount: 13,
        durationMinutes: 20,
        price: 0,
        access: "granted",
      },
    ]);
    const list = await listMockExams("MULTILEVEL");
    expect(list).toHaveLength(2);
    expect(list[0].profile).toBe("writing_speaking");
    expect(list[1].profile).toBe("diagnostic");
  });

  it("falls back safely when unexpected fields appear in raw array items", async () => {
    vi.mocked(get).mockResolvedValueOnce([
      {
        id: "exam-raw-fallback",
        type: "custom_future_track",
        profile: null,
        title: "Future Track Exam",
        skills: ["listening", "unknown_skill"],
        questionCount: 10,
      },
    ]);
    const list = await listMockExams("MULTILEVEL");
    expect(list).toHaveLength(1);
    expect(list[0].id).toBe("exam-raw-fallback");
    expect(list[0].profile).toBe("practice");
  });
});
