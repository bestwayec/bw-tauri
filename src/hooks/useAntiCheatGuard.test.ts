import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  getAntiCheatSeverity,
  isBlockedKeyCombo,
  setKioskLock,
  useAntiCheatGuard,
} from "./useAntiCheatGuard";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("setKioskLock", () => {
  it("engages and releases kiosk lock without throwing in test environment", async () => {
    await expect(setKioskLock(true)).resolves.not.toThrow();
    await expect(setKioskLock(false)).resolves.not.toThrow();
  });
});

describe("isBlockedKeyCombo", () => {
  it("detects Alt+Tab as blocked and violation", () => {
    const res = isBlockedKeyCombo({ altKey: true, key: "Tab" });
    expect(res.isBlocked).toBe(true);
    expect(res.isViolation).toBe(true);
  });

  it("detects Meta / Windows OS key as blocked and violation", () => {
    const res = isBlockedKeyCombo({ key: "Meta", metaKey: true });
    expect(res.isBlocked).toBe(true);
    expect(res.isViolation).toBe(true);
  });

  it("detects F11, F12, and PrintScreen as blocked and violation", () => {
    expect(isBlockedKeyCombo({ key: "F11" })).toEqual({ isBlocked: true, isViolation: true });
    expect(isBlockedKeyCombo({ key: "F12" })).toEqual({ isBlocked: true, isViolation: true });
    expect(isBlockedKeyCombo({ key: "PrintScreen" })).toEqual({ isBlocked: true, isViolation: true });
  });

  it("detects Devtools shortcuts (Ctrl+Shift+I / J / C) as violation", () => {
    const resI = isBlockedKeyCombo({ ctrlKey: true, shiftKey: true, key: "I" });
    expect(resI.isBlocked).toBe(true);
    expect(resI.isViolation).toBe(true);

    const resJ = isBlockedKeyCombo({ ctrlKey: true, shiftKey: true, key: "J" });
    expect(resJ.isBlocked).toBe(true);
    expect(resJ.isViolation).toBe(true);
  });

  it("detects clipboard and print combos (Ctrl+C, Ctrl+V, Ctrl+A, Ctrl+P) as blocked without triggering violation", () => {
    const resC = isBlockedKeyCombo({ ctrlKey: true, key: "c" });
    expect(resC.isBlocked).toBe(true);
    expect(resC.isViolation).toBe(false);

    const resV = isBlockedKeyCombo({ ctrlKey: true, key: "v" });
    expect(resV.isBlocked).toBe(true);
    expect(resV.isViolation).toBe(false);

    const resP = isBlockedKeyCombo({ ctrlKey: true, key: "p" });
    expect(resP.isBlocked).toBe(true);
    expect(resP.isViolation).toBe(false);
  });

  it("permits regular typing characters without blocking or violation", () => {
    const resA = isBlockedKeyCombo({ key: "a" });
    expect(resA.isBlocked).toBe(false);
    expect(resA.isViolation).toBe(false);

    const resSpace = isBlockedKeyCombo({ key: " " });
    expect(resSpace.isBlocked).toBe(false);
    expect(resSpace.isViolation).toBe(false);
  });
});

describe("getAntiCheatSeverity", () => {
  it("returns low severity for 0 and 1 strikes", () => {
    expect(getAntiCheatSeverity(0)).toBe("low");
    expect(getAntiCheatSeverity(1)).toBe("low");
  });

  it("returns medium severity for 2 strikes", () => {
    expect(getAntiCheatSeverity(2)).toBe("medium");
  });

  it("returns critical severity for 3 or more strikes", () => {
    expect(getAntiCheatSeverity(3)).toBe("critical");
    expect(getAntiCheatSeverity(4)).toBe("critical");
  });
});

describe("useAntiCheatGuard", () => {
  function Probe({ enabled }: { enabled: boolean }) {
    const { strikesCount, isWarningOpen, isTerminated, countdown } = useAntiCheatGuard({ enabled });
    return createElement(
      "div",
      null,
      `strikes:${strikesCount};warning:${isWarningOpen};term:${isTerminated};count:${countdown}`
    );
  }

  it("renders with initial state and safe defaults without throwing in non-DOM environment", () => {
    const htmlEnabled = renderToStaticMarkup(createElement(Probe, { enabled: true }));
    expect(htmlEnabled).toBe("<div>strikes:0;warning:false;term:false;count:10</div>");

    const htmlDisabled = renderToStaticMarkup(createElement(Probe, { enabled: false }));
    expect(htmlDisabled).toBe("<div>strikes:0;warning:false;term:false;count:10</div>");
  });
});
