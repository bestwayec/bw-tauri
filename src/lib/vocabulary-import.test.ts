import { describe, expect, it } from "vitest";
import { duplicateIndexes, mergeWithoutDuplicates, parseDelimited, spreadsheetToParserText, wordKey } from "./vocabulary-import";

describe("vocabulary import helpers", () => {
  it("mirrors the server duplicate rule (casefold + collapsed whitespace on both fields)", () => {
    expect(wordKey({ english: "  Apple ", uzbek: "OLMA" })).toBe(wordKey({ english: "apple", uzbek: "olma" }));
    expect(wordKey({ english: "ice  cream", uzbek: "muzqaymoq" })).toBe(wordKey({ english: "ice cream", uzbek: "muzqaymoq" }));
    // Same headword with a different translation is a legitimate separate entry.
    expect(duplicateIndexes([
      { english: "bank", uzbek: "bank" },
      { english: "bank", uzbek: "qirg‘oq" },
      { english: "Bank", uzbek: "BANK" },
    ])).toEqual(new Set([2]));
  });

  it("merges incoming rows without duplicates and counts the skipped ones", () => {
    const { words, skipped } = mergeWithoutDuplicates(
      [{ english: "apple", uzbek: "olma" }],
      [{ english: "Apple", uzbek: "olma" }, { english: "pear", uzbek: "nok" }, { english: "pear", uzbek: "nok" }],
    );
    expect(words.map((w) => w.english)).toEqual(["apple", "pear"]);
    expect(skipped).toBe(2);
  });

  it("parses quoted CSV, semicolon CSV and BOMs", () => {
    expect(parseDelimited('﻿english,uzbek\n"well-known","mashhur, taniqli"\n"say ""hi""",salom\r\n')).toEqual([
      ["english", "uzbek"], ["well-known", "mashhur, taniqli"], ['say "hi"', "salom"],
    ]);
    expect(parseDelimited("apple;olma\nbook;kitob")).toEqual([["apple", "olma"], ["book", "kitob"]]);
  });

  it("produces tab-separated parser lines, drops the header and flattens embedded newlines", () => {
    const csv = 'Word,Translation,Level\nself-confidence,o‘ziga ishonch,B2\n"multi\nline",ko‘p qatorli\nonly-one-cell\n';
    expect(spreadsheetToParserText("list.csv", csv)).toBe("self-confidence\to‘ziga ishonch\nmulti line\tko‘p qatorli");
    expect(spreadsheetToParserText("list.tsv", "apple\tolma\n")).toBe("apple\tolma");
    expect(spreadsheetToParserText("notes.txt", "apple - olma")).toBe("apple - olma");
  });
});
