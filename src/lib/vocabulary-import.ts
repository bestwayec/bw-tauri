/**
 * Client-side helpers for the teacher Vocabulary Builder.
 *
 * Parsing of word lines stays on the server (`/v1/vocabulary/sets/parse-text`);
 * these helpers only turn spreadsheet files into tab-separated text the server
 * parser already understands, and mirror the server's duplicate rule so a
 * teacher sees duplicates before publishing instead of a rejected save.
 */

export const MAX_IMPORT_BYTES = 512 * 1024;
export const IMPORT_ACCEPT = ".csv,.tsv,.txt,text/csv,text/tab-separated-values,text/plain";

type WordLike = { english?: string | null; uzbek?: string | null };

/** Same normalisation as `clean_words` in vocabulary_collections.py: casefold + collapse whitespace. */
export function wordKey(word: WordLike): string {
  const norm = (value?: string | null) => (value ?? "").toLocaleLowerCase().split(/\s+/).filter(Boolean).join(" ");
  return `${norm(word.english)}\u0000${norm(word.uzbek)}`;
}

/** Indexes of rows that repeat an earlier word/translation pair. */
export function duplicateIndexes(words: WordLike[]): Set<number> {
  const seen = new Set<string>();
  const duplicates = new Set<number>();
  words.forEach((word, index) => {
    const key = wordKey(word);
    if (seen.has(key)) duplicates.add(index);
    else seen.add(key);
  });
  return duplicates;
}

/** Appends `incoming` rows that are not already present; reports how many were skipped. */
export function mergeWithoutDuplicates<T extends WordLike>(existing: T[], incoming: T[]): { words: T[]; skipped: number } {
  const seen = new Set(existing.map(wordKey));
  const words = [...existing];
  let skipped = 0;
  for (const word of incoming) {
    const key = wordKey(word);
    if (seen.has(key)) {
      skipped += 1;
      continue;
    }
    seen.add(key);
    words.push(word);
  }
  return { words, skipped };
}

/** RFC 4180 CSV parsing with quoted fields; the delimiter is "," or ";" (Excel in uz/ru locales). */
export function parseDelimited(text: string, delimiter?: string): string[][] {
  const source = text.replace(/^﻿/, "");
  const firstLine = source.split(/\r?\n/, 1)[0] ?? "";
  const sep = delimiter ?? (firstLine.includes("\t") ? "\t" : (firstLine.split(";").length > firstLine.split(",").length ? ";" : ","));
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < source.length; i += 1) {
    const ch = source[i];
    if (quoted) {
      if (ch === '"' && source[i + 1] === '"') {
        cell += '"';
        i += 1;
      } else if (ch === '"') {
        quoted = false;
      } else {
        cell += ch;
      }
    } else if (ch === '"' && cell === "") {
      quoted = true;
    } else if (ch === sep) {
      row.push(cell);
      cell = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && source[i + 1] === "\n") i += 1;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else {
      cell += ch;
    }
  }
  if (cell !== "" || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }
  return rows.filter((cells) => cells.some((value) => value.trim() !== ""));
}

const HEADER = /^(english|word|so[‘'`ʻ]?z|inglizcha)$/i;

/**
 * Converts CSV/TSV/plain text into "english<TAB>translation" lines for the server parser.
 * Cells are flattened to single lines so a quoted newline cannot create a fake row.
 */
export function spreadsheetToParserText(fileName: string, text: string): string {
  if (/\.txt$/i.test(fileName)) return text;
  const rows = parseDelimited(text, /\.tsv$/i.test(fileName) ? "\t" : undefined);
  const body = rows.length > 0 && HEADER.test((rows[0][0] ?? "").trim()) ? rows.slice(1) : rows;
  return body
    .map((cells) => cells.slice(0, 2).map((value) => value.replace(/[\t\r\n]+/g, " ").trim()))
    .filter((cells) => cells.length === 2 && cells[0] && cells[1])
    .map((cells) => cells.join("\t"))
    .join("\n");
}

/** Reads a picked file as UTF-8 text via FileReader (available in every supported browser/WebView). */
export function readFileText(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(typeof reader.result === "string" ? reader.result : "");
    reader.onerror = () => reject(reader.error ?? new Error("FILE_READ_FAILED"));
    reader.readAsText(file, "utf-8");
  });
}
