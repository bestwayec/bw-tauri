import { describe, expect, it } from "vitest";
import { mapCheatEventToKind, type LockdownCheatEvent } from "./useLockdown";

describe("mapCheatEventToKind", () => {
  it("maps visibility loss to tab_switch and window blur to blur", () => {
    expect(mapCheatEventToKind("visibilitychange:hidden")).toBe("tab_switch");
    expect(mapCheatEventToKind("window:blur")).toBe("blur");
    expect(mapCheatEventToKind("multimonitor:detected")).toBe("blur");
  });

  it("maps clipboard events to paste", () => {
    expect(mapCheatEventToKind("copy")).toBe("paste");
    expect(mapCheatEventToKind("cut")).toBe("paste");
    expect(mapCheatEventToKind("paste")).toBe("paste");
  });

  it("maps blocked keyboard shortcuts to shortcut", () => {
    const shortcuts: LockdownCheatEvent[] = [
      "keydown:f12",
      "keydown:devtools",
      "keydown:print",
      "keydown:save",
      "keydown:view-source",
    ];
    for (const ev of shortcuts) {
      expect(mapCheatEventToKind(ev)).toBe("shortcut");
    }
  });

  it("returns null for local-only UI events (contextmenu, dragstart)", () => {
    expect(mapCheatEventToKind("contextmenu")).toBeNull();
    expect(mapCheatEventToKind("dragstart")).toBeNull();
  });
});

describe("multimonitor transition detection logic", () => {
  it("only reports on transition from 1 to >1 monitors and deduplicates repeated polls", () => {
    let lastMonitorCount = 1;
    let lastMonitorViolationAt = 0;
    const reported: Array<{ at: number; count: number }> = [];

    const handlePoll = (count: number, now: number) => {
      if (count > 1 && (lastMonitorCount <= 1 || now - lastMonitorViolationAt > 60_000)) {
        lastMonitorViolationAt = now;
        reported.push({ at: now, count });
      }
      lastMonitorCount = count;
    };

    // Poll 1: 1 monitor -> no report
    handlePoll(1, 1000);
    expect(reported).toHaveLength(0);

    // Poll 2: 2 monitors attached (transition 1 -> 2) -> reported
    handlePoll(2, 4000);
    expect(reported).toHaveLength(1);
    expect(reported[0]).toEqual({ at: 4000, count: 2 });

    // Poll 3: 2 monitors still attached 3s later (no transition) -> DEDUPLICATED (not reported!)
    handlePoll(2, 7000);
    expect(reported).toHaveLength(1);

    // Poll 4: 2 monitors still attached 10s later -> DEDUPLICATED
    handlePoll(2, 17000);
    expect(reported).toHaveLength(1);

    // Poll 5: Monitor detached (drops back to 1)
    handlePoll(1, 20000);
    expect(reported).toHaveLength(1);

    // Poll 6: Monitor re-attached (transition 1 -> 2) -> reported again!
    handlePoll(2, 23000);
    expect(reported).toHaveLength(2);
    expect(reported[1]).toEqual({ at: 23000, count: 2 });
  });
});
