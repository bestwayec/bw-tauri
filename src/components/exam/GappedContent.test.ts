import { describe, expect, it } from "vitest";
import { gapNumbersIn, hasGappedDocument } from "./GappedContent";

describe("hasGappedDocument", () => {
  it("is true only for non-blank documents", () => {
    expect(hasGappedDocument('<p><span data-gap="1"></span></p>')).toBe(true);
    expect(hasGappedDocument("   ")).toBe(false);
    expect(hasGappedDocument(null)).toBe(false);
    expect(hasGappedDocument(undefined)).toBe(false);
  });
});

describe("gapNumbersIn", () => {
  it("finds canonical gap atoms", () => {
    expect(gapNumbersIn('<p>Room <span data-gap="1"></span></p>')).toEqual([1]);
  });
  it("tolerates non-canonical inner text (backend normalizes, client must not miss)", () => {
    expect(
      gapNumbersIn('<table><tbody><tr><td>keen <span data-gap="12">source text</span></td></tr></tbody></table>'),
    ).toEqual([12]);
  });
  it("drops out-of-range numbers", () => {
    expect(gapNumbersIn('<p><span data-gap="0"></span><span data-gap="201"></span><span data-gap="3"></span></p>')).toEqual([
      3,
    ]);
  });
  it("returns [] when there are no gaps", () => {
    expect(gapNumbersIn("<p>No gaps</p>")).toEqual([]);
  });
  it("finds several gaps in order", () => {
    expect(gapNumbersIn('<li>Note <span data-gap="8"></span> and <span data-gap="9"></span></li>')).toEqual([8, 9]);
  });
});
