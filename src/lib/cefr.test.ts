import { describe, expect, it } from "vitest";
import { cefrText, normalizeCefr } from "./cefr";

describe("CEFR levels from the server", () => {
  it("accepts every level the server can send, including C2 and BELOW_B1", () => {
    for (const level of ["C2", "C1", "B2", "B1", "BELOW_B1"]) expect(normalizeCefr(level)).toBe(level);
    expect(normalizeCefr(" c1 ")).toBe("C1");
    expect(normalizeCefr("below b1")).toBe("BELOW_B1");
    expect(normalizeCefr("below-b1")).toBe("BELOW_B1");
  });

  it("keeps results saved under the old scales as they are stored", () => {
    expect(normalizeCefr("A2")).toBe("A2");
    expect(normalizeCefr("A1")).toBe("A1");
  });

  it("returns nothing for anything else: no level is ever guessed", () => {
    for (const value of [null, undefined, "", "D1", "B3", 7, {}, []]) expect(normalizeCefr(value)).toBeNull();
  });

  it("writes BELOW_B1 out as words and prints a missing level as a dash", () => {
    expect(cefrText("BELOW_B1")).toBe("Below B1");
    expect(cefrText("C2")).toBe("C2");
    expect(cefrText(null)).toBe("—");
    expect(cefrText(undefined)).toBe("—");
  });
});
