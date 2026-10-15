/**
 * End-to-end single-section verification through the DESKTOP CLIENT itself.
 *
 * Unlike tools/mock-server/integration.test.ts (which proves the server
 * contract with raw fetch), this test spawns the same backend and drives the
 * app's real code path: `startMockExam` -> zod schema -> `targetSectionOf` ->
 * `mockSectionToParts` -> `submitSkillsFor` -> `submitMockAttempt`.
 *
 * Acceptance criteria covered:
 *  - a single-section start sends the section scope and receives ONLY that
 *    section (the other sections are never downloaded, so they can never be
 *    rendered as tabs/questions);
 *  - that attempt submits cleanly without the other sections' answers.
 */
import { spawn, type ChildProcess } from "node:child_process";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
// Lives under tools/ (like the other server-driven suites) so the app's own
// `tsc` build, which only includes src/, stays free of Node typings.
import { mockSectionToParts } from "@/components/exam-ui/model";
import { startMockExam, submitMockAttempt, submitSkillsFor, targetSectionOf, type MockSkill } from "@/lib/mocks";

const PORT = 3113;
const BASE = `http://127.0.0.1:${PORT}/v1`;
const SERVER = path.resolve(import.meta.dirname, "./server.mjs");

// Inlined (not `${PORT}`): vi.mock factories are hoisted above the constants.
vi.mock("@/lib/config", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/config")>()),
  API_BASE_URL: "http://127.0.0.1:3113/v1",
}));

// The app client reads its bearer token from the session store; the store
// itself is exercised by session-store.test.ts, so only the token getter is
// supplied here.
const auth = { token: "" };
vi.mock("@/lib/session-store", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/session-store")>()),
  getSessionAccessToken: () => auth.token || null,
}));

let proc: ChildProcess | null = null;

async function waitUp(tries = 60): Promise<void> {
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(`${BASE}/auth/me`);
      if (r.status === 401) return;
    } catch {
      /* not listening yet */
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error("mock server did not start");
}

beforeAll(async () => {
  proc = spawn(process.execPath, [SERVER, `--port=${PORT}`], { stdio: "ignore" });
  await waitUp();
  const res = await fetch(`${BASE}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ phone: "+998900000010", password: "Student123!" }),
  });
  const json = (await res.json()) as { data: { accessToken: string } };
  auth.token = json.data.accessToken;
}, 60_000);

afterAll(async () => {
  proc?.kill();
  proc = null;
});

describe("desktop single-section attempt, end to end", () => {
  it("starts scoped, renders only the chosen section and submits without the others", async () => {
    const start = await startMockExam("mock-1", { mode: "practice", flow: "single_skill", section: "writing" });

    // Server-authoritative scope survives the client's zod validation.
    expect(start.isSingleSection).toBe(true);
    expect(start.singleSection).toBe("writing");
    expect(start.attemptTypeLabel).toBe("Single Section: Writing");
    expect(start.flowMode).toBe("single_skill");
    expect(start.exam.sections.map((s) => s.skill)).toEqual(["writing"]);

    // The runner opens straight into Writing and adapts only Writing's parts.
    const skill = targetSectionOf(start, "writing");
    expect(skill).toBe("writing");
    const section = start.exam.sections.find((s) => s.skill === skill)!;
    const parts = mockSectionToParts(section, start.attemptId, false);
    expect(parts.map((p) => p.label)).toEqual(["Task 1", "Task 2"]);
    const questionIds = parts.flatMap((p) => p.questions.map((q) => q.id));
    // Nothing from Listening/Reading/Speaking leaks into the runner.
    expect(parts.every((p) => p.audioUrl === null)).toBe(true);
    expect(questionIds.length).toBe(section.groups.flatMap((g) => g.questions).length);
    expect(questionIds.length).toBeGreaterThan(0);

    // Timer: the scoped section's own deadline only (untimed practice => none).
    expect(start.sectionDeadlines?.reading).toBeUndefined();

    // Clean submit: a scoped attempt declares no skills and owes no other section.
    const submitArg = submitSkillsFor(start, skill as MockSkill);
    expect(submitArg).toBeUndefined();
    const result = await submitMockAttempt(start.attemptId, submitArg);
    expect(result.status).toBe("completed");
    expect(Object.keys(result.rawScores)).toEqual(["writing"]);
  });

  it("scopes each section independently and never mixes two skills in one attempt", async () => {
    for (const skill of ["listening", "reading", "speaking"] as MockSkill[]) {
      const start = await startMockExam("mock-1", { mode: "practice", section: skill });
      expect(start.singleSection).toBe(skill);
      expect(start.exam.sections.map((s) => s.skill)).toEqual([skill]);
      const section = start.exam.sections[0];
      const parts = mockSectionToParts(section, start.attemptId, false);
      // Every part belongs to the scoped section's groups, in order.
      expect(parts.map((p) => p.key)).toEqual(section.groups.map((g) => g.id));
      const result = await submitMockAttempt(start.attemptId, submitSkillsFor(start, skill));
      expect(Object.keys(result.rawScores)).toEqual([skill]);
    }
  });

  it("keeps the full mock unscoped so all four sections load in order", async () => {
    const start = await startMockExam("mock-1", { mode: "practice", flow: "full_test" });
    expect(start.isSingleSection).toBeUndefined();
    expect(start.singleSection).toBeUndefined();
    expect(start.exam.sections.map((s) => s.skill)).toEqual(["listening", "reading", "writing", "speaking"]);
    // A full mock still declares the section being finished.
    expect(submitSkillsFor(start, "reading")).toEqual(["reading"]);
  });
});
