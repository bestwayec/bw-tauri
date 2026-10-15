import { describe, expect, it } from "vitest";
import {
  clampSplit,
  EXAM_SPLIT_MIN_WIDTH,
  examLayout,
  nudgeSplit,
  readSplit,
  SPLIT_DEFAULT,
  SPLIT_MAX,
  SPLIT_MIN,
  splitColumns,
  splitStorageKey,
  splitValueText,
  writeSplit,
} from "./exam-layout";

function fakeStorage(seed: Record<string, string> = {}): Storage {
  const data = new Map(Object.entries(seed));
  return {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => {
      data.set(key, String(value));
    },
    removeItem: (key: string) => {
      data.delete(key);
    },
    clear: () => data.clear(),
    key: (index: number) => [...data.keys()][index] ?? null,
    get length() {
      return data.size;
    },
  } as Storage;
}

describe("reading/listening desktop layout", () => {
  it("splits wide windows, stacks narrow ones and stays single-column without a passage", () => {
    expect(examLayout(true, 1920)).toBe("split");
    expect(examLayout(true, EXAM_SPLIT_MIN_WIDTH)).toBe("split");
    expect(examLayout(true, EXAM_SPLIT_MIN_WIDTH - 1)).toBe("stacked");
    expect(examLayout(true, 1280)).toBe("split");
    expect(examLayout(true, 900)).toBe("stacked");
    // No passage (Listening) is always one column, whatever the width.
    expect(examLayout(false, 2560)).toBe("single");
    expect(examLayout(false, 600)).toBe("single");
  });

  it("keeps the CBT split when the viewport cannot be measured", () => {
    expect(examLayout(true, null)).toBe("split");
    expect(examLayout(false, null)).toBe("single");
  });
});

describe("divider position", () => {
  it("clamps to the panel bounds and repairs unusable input", () => {
    expect(clampSplit(50)).toBe(50);
    expect(clampSplit(10)).toBe(SPLIT_MIN);
    expect(clampSplit(95)).toBe(SPLIT_MAX);
    expect(clampSplit(50.4)).toBe(50);
    expect(clampSplit(Number.NaN)).toBe(SPLIT_DEFAULT);
    expect(clampSplit(Number.POSITIVE_INFINITY)).toBe(SPLIT_DEFAULT);
    expect(clampSplit(SPLIT_MIN - 0.4)).toBe(SPLIT_MIN);
  });

  it("builds a three-track grid so the divider keeps its own 8px column", () => {
    expect(splitColumns(50)).toBe("50% 8px 50%");
    expect(splitColumns(70)).toBe("70% 8px 30%");
    // Out-of-range values are clamped before they reach the template.
    expect(splitColumns(5)).toBe(`${SPLIT_MIN}% 8px ${100 - SPLIT_MIN}%`);
  });

  it("nudges with the arrow keys and jumps to the bounds with Home/End", () => {
    expect(nudgeSplit("ArrowRight", 50)).toBe(55);
    expect(nudgeSplit("ArrowLeft", 50)).toBe(45);
    expect(nudgeSplit("ArrowLeft", SPLIT_MIN)).toBe(SPLIT_MIN);
    expect(nudgeSplit("ArrowRight", SPLIT_MAX)).toBe(SPLIT_MAX);
    expect(nudgeSplit("Home", 60)).toBe(SPLIT_MIN);
    expect(nudgeSplit("End", 60)).toBe(SPLIT_MAX);
    expect(nudgeSplit("PageDown", 44)).toBe(44);
  });

  it("describes the split for screen readers", () => {
    expect(splitValueText(60)).toBe("60% passage, 40% questions");
    expect(splitValueText(999)).toBe(`${SPLIT_MAX}% passage, ${100 - SPLIT_MAX}% questions`);
  });
});

describe("divider persistence", () => {
  const attempt = "attempt-1";

  it("stores and restores the position per attempt", () => {
    const store = fakeStorage();
    expect(readSplit(attempt, store)).toBe(SPLIT_DEFAULT);
    writeSplit(attempt, 62, store);
    expect(readSplit(attempt, store)).toBe(62);
    expect(store.getItem(splitStorageKey(attempt))).toBe("62");
    // A different attempt is unaffected.
    expect(readSplit("attempt-2", store)).toBe(SPLIT_DEFAULT);
  });

  it("clamps on write and ignores corrupt or unreadable storage", () => {
    const store = fakeStorage();
    writeSplit(attempt, 99, store);
    expect(readSplit(attempt, store)).toBe(SPLIT_MAX);
    expect(readSplit(attempt, fakeStorage({ [splitStorageKey(attempt)]: "not-a-number" }))).toBe(SPLIT_DEFAULT);
    expect(readSplit(attempt, null)).toBe(SPLIT_DEFAULT);
    // A throwing store (private mode) never propagates.
    const dead = { getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("blocked"); } } as unknown as Storage;
    expect(readSplit(attempt, dead)).toBe(SPLIT_DEFAULT);
    expect(() => writeSplit(attempt, 55, dead)).not.toThrow();
  });
});
