import { describe, expect, it } from "vitest";
import type { MockShapedQuestion, MockShapedSection } from "@/lib/mocks";
import type { RunnerQuestion } from "@/lib/tests";
import {
  fmtCountdown,
  isAnswered,
  legacyKindOf,
  legacyStartToParts,
  mockKindOf,
  mockSectionToParts,
  nextUnanswered,
  orphanGaps,
  questionState,
  remainingMs,
  serverOffsetMs,
  widgetFor,
} from "./model";

function mq(over: Partial<MockShapedQuestion> & { id: string; number: number }): MockShapedQuestion {
  return {
    sortOrder: over.number,
    type: "short_answer",
    prompt: `Q${over.number}`,
    options: null,
    points: 1,
    wordLimit: null,
    ...over,
  };
}

function section(over: Partial<MockShapedSection> = {}): MockShapedSection {
  return {
    id: "sec-1",
    skill: "reading",
    title: null,
    sortOrder: 0,
    durationMinutes: null,
    instructions: null,
    groups: [],
    ...over,
  };
}

describe("mockKindOf covers all 15 backend types", () => {
  const cases: Array<[MockShapedQuestion["type"], string]> = [
    ["multiple_choice", "single_choice"],
    ["multi_select", "multi_select"],
    ["true_false_notgiven", "tfng"],
    ["yes_no_notgiven", "ynng"],
    ["matching", "matching"],
    ["matching_headings", "matching_headings"],
    ["sentence_completion", "completion"],
    ["note_completion", "completion"],
    ["summary_completion", "completion"],
    ["table_completion", "completion"],
    ["short_answer", "short_answer"],
    ["map_labelling", "map_label"],
    ["essay_task1", "essay"],
    ["essay_task2", "essay"],
    ["speaking_task", "speaking"],
  ];
  for (const [type, kind] of cases) {
    it(`${type} -> ${kind}`, () => {
      expect(mockKindOf(type)).toBe(kind);
    });
  }
});

describe("widgetFor", () => {
  it("maps every kind to a dedicated widget", () => {
    expect(widgetFor("single_choice", true)).toBe("radio");
    expect(widgetFor("multi_select", true)).toBe("checkbox");
    expect(widgetFor("tfng", true)).toBe("tfng");
    expect(widgetFor("ynng", true)).toBe("ynng");
    expect(widgetFor("matching", true)).toBe("matching");
    expect(widgetFor("matching_headings", true)).toBe("matching");
    expect(widgetFor("map_label", true)).toBe("map");
    expect(widgetFor("completion", false)).toBe("inline");
    expect(widgetFor("short_answer", false)).toBe("short");
    expect(widgetFor("essay", false)).toBe("essay");
    expect(widgetFor("speaking", false)).toBe("speaking");
  });
  it("falls back to short input when options are missing", () => {
    expect(widgetFor("matching", false)).toBe("short");
  });
});

describe("legacyKindOf", () => {
  const q = (kind: string): RunnerQuestion => ({
    id: "q",
    section: "reading",
    type: "short_answer",
    prompt: "p",
    options: null,
    maxScore: 1,
    kind,
  });
  it("maps explicit kinds", () => {
    expect(legacyKindOf(q("multiple_choice"))).toBe("single_choice");
    expect(legacyKindOf(q("tfng"))).toBe("tfng");
    expect(legacyKindOf(q("matching"))).toBe("matching");
    expect(legacyKindOf(q("essay"))).toBe("essay");
  });
});

describe("mockSectionToParts", () => {
  it("numbers questions globally across groups in sort order", () => {
    const s = section({
      skill: "reading",
      groups: [
        {
          id: "g2",
          sortOrder: 1,
          title: null,
          instructions: null,
          passageText: null,
          contentHtml: null,
          contentLayout: null,
          hasAudio: false,
          audioUrl: null,
          imageUrl: null,
          partNumber: null,
          audioDurationSec: null,
          audioPlayLimit: 0,
          questions: [mq({ id: "q3", number: 3 }), mq({ id: "q4", number: 4 })],
        },
        {
          id: "g1",
          sortOrder: 0,
          title: null,
          instructions: null,
          passageText: null,
          contentHtml: null,
          contentLayout: null,
          hasAudio: false,
          audioUrl: null,
          imageUrl: null,
          partNumber: null,
          audioDurationSec: null,
          audioPlayLimit: 0,
          questions: [mq({ id: "q1", number: 1 }), mq({ id: "q2", number: 2 })],
        },
      ],
    });
    const parts = mockSectionToParts(s, "att-1", false);
    expect(parts.map((x) => x.key)).toEqual(["g1", "g2"]);
    expect(parts.map((x) => x.label)).toEqual(["Passage 1", "Passage 2"]);
    expect(parts.flatMap((x) => x.questions.map((q) => q.number))).toEqual([1, 2, 3, 4]);
  });
  it("enables strict audio only for timed listening with an audio URL", () => {
    const g = {
      id: "g",
      sortOrder: 0,
      title: null,
      instructions: null,
      passageText: null,
      contentHtml: null,
      contentLayout: null,
      hasAudio: true,
      audioUrl: "/v1/mock/groups/g/audio",
      imageUrl: null,
      partNumber: null,
      audioDurationSec: null,
      audioPlayLimit: 1,
      questions: [mq({ id: "q", number: 1, type: "multiple_choice", options: ["a"] })],
    };
    const timed = mockSectionToParts(section({ skill: "listening", groups: [g] }), "att", true);
    expect(timed[0].strictAudio).toBe(true);
    expect(timed[0].audioUrl).toContain("attemptId=att");
    const practice = mockSectionToParts(section({ skill: "listening", groups: [g] }), "att", false);
    expect(practice[0].strictAudio).toBe(false);
    expect(practice[0].audioUrl).not.toContain("attemptId");
    const reading = mockSectionToParts(section({ skill: "reading", groups: [g] }), "att", true);
    expect(reading[0].strictAudio).toBe(false);
  });
});

describe("legacyStartToParts", () => {
  const lq = (id: string, section: RunnerQuestion["section"], extra = {}): RunnerQuestion => ({
    id,
    section,
    type: "short_answer",
    prompt: id,
    options: null,
    maxScore: 1,
    ...extra,
  });
  it("groups consecutive same-section questions and numbers globally", () => {
    const parts = legacyStartToParts({
      attemptId: "a",
      resumed: false,
      durationMinutes: null,
      startedAt: new Date().toISOString(),
      questions: [lq("a", "reading"), lq("b", "reading"), lq("c", "writing")],
    });
    expect(parts).toHaveLength(2);
    expect(parts[0].questions.map((q) => q.number)).toEqual([1, 2]);
    expect(parts[1].questions.map((q) => q.number)).toEqual([3]);
    expect(parts[0].label).toBe("Passage 1");
  });
});

describe("navigation state", () => {
  it("current wins over flagged/answered", () => {
    expect(questionState(2, 2, true, true)).toBe("current");
    expect(questionState(1, 2, false, true)).toBe("flagged");
    expect(questionState(1, 2, true, false)).toBe("answered");
    expect(questionState(1, 2, false, false)).toBe("unanswered");
  });
  it("isAnswered counts audio takes and trims whitespace", () => {
    expect(isAnswered("  ", false)).toBe(false);
    expect(isAnswered("", true)).toBe(true);
    expect(isAnswered("x", false)).toBe(true);
  });
  it("nextUnanswered wraps and returns null when complete", () => {
    expect(nextUnanswered(4, 0, [true, false, true, true])).toBe(1);
    expect(nextUnanswered(4, 3, [false, true, true, true])).toBe(0);
    expect(nextUnanswered(2, 0, [true, true])).toBeNull();
  });
});

describe("deadlines", () => {
  it("measures client clock skew from serverTime", () => {
    expect(serverOffsetMs("2026-10-01T10:00:10.000Z", Date.parse("2026-10-01T10:00:00.000Z"))).toBe(10000);
    expect(serverOffsetMs("garbage")).toBe(0);
  });
  it("corrects remaining time for skew and handles untimed", () => {
    const now = Date.parse("2026-10-01T10:00:00.000Z");
    // Server is 10s ahead; deadline 60s after server-now => 50s of client time left.
    expect(remainingMs("2026-10-01T10:01:00.000Z", 10000, now)).toBe(50000);
    expect(remainingMs(null, 0, now)).toBeNull();
    expect(remainingMs("garbage", 0, now)).toBeNull();
  });
  it("formats countdowns", () => {
    expect(fmtCountdown(65_000)).toBe("1:05");
    expect(fmtCountdown(3_661_000)).toBe("1:01:01");
    expect(fmtCountdown(-500)).toBe("0:00");
  });
});

describe("orphanGaps", () => {
  it("reports gap tokens with no matching question", () => {
    const html = '<p>A <span data-gap="1"></span> B <span data-gap="9"></span></p>';
    expect(orphanGaps(html, [1, 2])).toEqual([9]);
    expect(orphanGaps(html, [1, 9])).toEqual([]);
  });
});
