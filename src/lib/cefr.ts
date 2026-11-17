/**
 * CEFR levels exactly as the server reports them. The server owns every scale (IELTS: the ielts.org
 * band map, C2 8.5 / C1 7.0 / B2 5.5 / B1 4.0; Multilevel: C1 65 / B2 51 / B1 38 of 75), so this app
 * never turns a score into a level itself: it only recognises and prints what it was given.
 */
export type CefrLevel = "C2" | "C1" | "B2" | "B1" | "BELOW_B1";
/** Results saved before the scales were aligned can still carry A2 / A1; they are shown as stored. */
export type StoredCefrLevel = CefrLevel | "A2" | "A1";

const KNOWN: readonly string[] = ["C2", "C1", "B2", "B1", "BELOW_B1", "A2", "A1"];

export function normalizeCefr(value: unknown): StoredCefrLevel | null {
  if (typeof value !== "string") return null;
  const level = value.trim().toUpperCase().replace(/[\s-]+/g, "_");
  return KNOWN.includes(level) ? (level as StoredCefrLevel) : null;
}

/** BELOW_B1 is a code, not a level: show it as words. */
export function cefrText(level: StoredCefrLevel | null | undefined): string {
  return !level ? "—" : level === "BELOW_B1" ? "Below B1" : level;
}
