import { describe, expect, it } from "vitest";
import { mapCheatEventToKind, type LockdownCheatEvent } from "./useLockdown";

describe("mapCheatEventToKind", () => {
  it("maps visibility loss to tab_switch and window blur to blur", () => {
    expect(mapCheatEventToKind("visibilitychange:hidden")).toBe("tab_switch");
    expect(mapCheatEventToKind("window:blur")).toBe("blur");
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
