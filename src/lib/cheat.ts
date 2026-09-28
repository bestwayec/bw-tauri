import { post } from "./api";

export type CheatKind = "tab_switch" | "blur" | "paste" | "shortcut";
export type CheatScope = "tests" | "mock";

/**
 * Report a cheating signal for an attempt.
 * - scope "tests" -> POST /tests/attempts/:id/flag-cheat
 * - scope "mock"  -> POST /mock/attempts/:id/flag-cheat
 *
 * Backend `FlagCheatDto` requires `{ event: string <=50 }` with
 * whitelist validation — extra keys are rejected. Map kind -> event.
 *
 * Fire-and-forget from the lockdown window event handlers; resolves when acked.
 */
export function reportCheat(
  attemptId: string,
  kind: CheatKind,
  scope: CheatScope,
): Promise<void> {
  const base = scope === "tests" ? "/tests/attempts" : "/mock/attempts";
  return post<void>(`${base}/${encodeURIComponent(attemptId)}/flag-cheat`, {
    event: kind,
  });
}
