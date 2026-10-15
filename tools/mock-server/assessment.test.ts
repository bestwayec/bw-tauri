/**
 * AI assessment contract against tools/mock-server (spawns it).
 *
 * submit -> a job is enqueued per Writing/Speaking skill
 *        -> GET /assessment/attempts/:id walks PENDING -> PROCESSING -> SUCCEEDED
 *        -> the payload is parsed with the desktop client's OWN zod schema
 *           (src/lib/assessment.ts), so the dev backend and the client contract
 *           can never drift apart.
 *
 * Raw fetch (like the sibling integration test): this verifies the SERVER
 * contract the app codes against.
 */
import { spawn, type ChildProcess } from "node:child_process";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { assessmentAttemptSchema, type AssessmentAttempt } from "@/lib/assessment";

// Only the assessment contract is under test here: the real api module (session
// store + Tauri bridge) must never load in a node test.
vi.mock("@/lib/api", () => ({ get: vi.fn(), API_BASE_URL: "https://api.example.test/v1" }));

const PORT = 3115;
const BASE = `http://127.0.0.1:${PORT}/v1`;
const SERVER = path.resolve(import.meta.dirname, "./server.mjs");

let proc: ChildProcess | null = null;
let token = "";

function startServer(): void {
  proc = spawn(process.execPath, [SERVER, `--port=${PORT}`], { stdio: "ignore" });
}

async function waitUp(tries = 60): Promise<void> {
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(`${BASE}/auth/me`);
      if (r.status === 401) return; // up (rejects anonymous callers)
    } catch {
      /* not listening yet */
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error("mock server did not start");
}

interface ApiResult {
  status: number;
  json: { success?: boolean; data?: unknown; error?: { code?: string; message?: string } };
}

async function api(
  path: string,
  init: { method?: string; token?: string | null; body?: unknown } = {},
): Promise<ApiResult> {
  const res = await fetch(`${BASE}${path}`, {
    method: init.method ?? "GET",
    headers: {
      ...(init.body !== undefined ? { "Content-Type": "application/json" } : {}),
      ...(init.token ? { Authorization: `Bearer ${init.token}` } : {}),
    },
    body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
  });
  let json: ApiResult["json"] = {};
  try {
    json = (await res.json()) as ApiResult["json"];
  } catch {
    /* non-JSON response */
  }
  return { status: res.status, json };
}

interface StartData {
  attemptId: string;
  exam: {
    sections: Array<{ skill: string; groups: Array<{ questions: Array<{ id: string; number: number; type: string }> }> }>;
  };
}

async function startSection(skill: string): Promise<StartData> {
  const r = await api("/mock/exams/mock-1/start", {
    method: "POST",
    token,
    body: { mode: "practice", flow: "single_skill", section: skill },
  });
  expect(r.status).toBe(200);
  return r.json.data as StartData;
}

function questionsOf(start: StartData, skill: string) {
  return (start.exam.sections.find((s) => s.skill === skill)?.groups ?? []).flatMap((g) => g.questions);
}

async function saveAnswer(attemptId: string, questionId: string, response: string): Promise<void> {
  const r = await api(`/mock/attempts/${attemptId}/answer`, { method: "POST", token, body: { questionId, response } });
  expect(r.status).toBe(200);
}

async function submit(attemptId: string, body: Record<string, unknown>): Promise<ApiResult> {
  return api(`/mock/attempts/${attemptId}/submit`, { method: "POST", token, body });
}

async function readAssessment(attemptId: string): Promise<ApiResult> {
  return api(`/assessment/attempts/${encodeURIComponent(attemptId)}`, { token });
}

/** Poll until the job is terminal, remembering every status the client would see. */
async function waitForSucceeded(attemptId: string, timeoutMs = 12_000) {
  const deadline = Date.now() + timeoutMs;
  const seen: string[] = [];
  for (;;) {
    const r = await readAssessment(attemptId);
    expect(r.status).toBe(200);
    const data = r.json.data as AssessmentAttempt;
    seen.push(data.assessments[0]?.status ?? "none");
    if (data.assessments[0]?.status === "SUCCEEDED" || Date.now() > deadline) return { data, seen };
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
}

beforeAll(async () => {
  startServer();
  await waitUp();
  const login = await api("/auth/login", {
    method: "POST",
    body: { phone: "+998900000010", password: "Student123!" },
  });
  expect(login.status).toBe(200);
  token = (login.json.data as { accessToken: string }).accessToken;
}, 60_000);

afterAll(() => {
  proc?.kill();
  proc = null;
});

describe("AI assessment after submit", () => {
  it(
    "queues a writing assessment, then reports schema-valid rubric feedback",
    async () => {
    const start = await startSection("writing");
    const questions = questionsOf(start, "writing");
    expect(questions.length).toBeGreaterThan(0);
    await saveAnswer(start.attemptId, questions[0].id, "People is good at learning and I support this view. However, the other side matters too.");
    await saveAnswer(start.attemptId, questions[1].id, "In conclusion, both views have merit and the discussion continues in the essay.");

    const submitted = await submit(start.attemptId, { assessmentDelayMs: 3000 });
    expect(submitted.status).toBe(200);
    // The grading payload itself is unchanged by the assessment side effect.
    expect((submitted.json.data as { status: string }).status).toBe("completed");

    // Immediately after the submit the job is still queued: no invented score.
    const queued = await readAssessment(start.attemptId);
    expect(queued.status).toBe(200);
    const queuedData = queued.json.data as AssessmentAttempt;
    expect(queuedData.attemptId).toBe(start.attemptId);
    expect(queuedData.assessments).toHaveLength(1);
    expect(queuedData.assessments[0].status).toBe("PENDING");
    expect(queuedData.assessments[0].aiScore).toBeNull();
    expect(queuedData.assessments[0].evaluation).toBeNull();

    const { data, seen } = await waitForSucceeded(start.attemptId);
    const assessment = assessmentAttemptSchema.parse(data).assessments[0];
    expect(assessment.skill).toBe("writing");
    expect(assessment.program).toBe("IELTS_ACADEMIC");
    expect(assessment.status).toBe("SUCCEEDED");
    expect(assessment.aiScore).not.toBeNull();
    expect(assessment.finalScore).toBeNull(); // the teacher stays the final authority
    expect(assessment.rubricVersion).toContain("WRITING");
    expect(assessment.parts.map((p) => p.id)).toEqual(questions.map((q) => q.id));
    expect(assessment.submissions).toHaveLength(questions.length);
    expect(assessment.submissions[0].originalResponse).toContain("People is good");
    expect(assessment.submissions[0].wordCount).toBeGreaterThan(0);

    const result = assessment.evaluation?.result;
    expect(result).toBeTruthy();
    expect(result?.parts).toHaveLength(questions.length);
    // Feedback quotes only patterns the answer really contains.
    expect(result?.grammarCorrections).toContainEqual({
      original: "people is",
      corrected: "people are",
      explanation: expect.any(String),
    });
    expect(result?.vocabularyUpgrades.some((u) => u.original === "good")).toBe(true);
    expect(result?.priorityImprovements.length).toBeGreaterThan(0);
    expect(result?.pronunciationEvidence).toBe("UNAVAILABLE");
    expect(result?.parts[0].feedback.forCovered).toBe(true);
    expect(result?.parts[0].feedback.againstCovered).toBe(true);
    expect(result?.parts[0].feedback.strengths.length).toBeGreaterThan(0);
    expect(result?.parts[0].feedback.usefulPhrases.length).toBeGreaterThan(0);
    // IELTS parts score the four criteria as bands; no invented holistic raw score.
    expect(result?.parts[0].criteria).toMatchObject({ task_response: expect.any(Number) });

    // The queue really moved: first observation queued, last one terminal.
    expect(seen[0]).toBe("PENDING");
    expect(seen.at(-1)).toBe("SUCCEEDED");
    for (const status of seen) expect(["PENDING", "PROCESSING", "SUCCEEDED"]).toContain(status);

    // Provider-only fields must never reach the student payload.
    const raw = JSON.stringify(data);
    for (const secret of ["providerCredentials", "inputHash", "inputSnapshot", "leaseToken", "provider_payload"]) {
      expect(raw).not.toContain(secret);
    }
    },
    30_000,
  );

  it("enqueues nothing for a listening-only attempt", async () => {
    const start = await startSection("listening");
    const [question] = questionsOf(start, "listening");
    await saveAnswer(start.attemptId, question.id, "Two");
    expect((await submit(start.attemptId, { assessmentDelayMs: 0 })).status).toBe(200);
    const r = await readAssessment(start.attemptId);
    expect(r.status).toBe(200);
    expect((r.json.data as AssessmentAttempt).assessments).toEqual([]);
  });

  it("keeps an uploaded speaking take as audio and transcribes it", async () => {
    const start = await startSection("speaking");
    const [question] = questionsOf(start, "speaking");
    const upload = await api(`/mock/attempts/${start.attemptId}/speaking/${question.id}`, { method: "POST", token });
    expect(upload.status).toBe(200);
    expect((await submit(start.attemptId, { assessmentDelayMs: 0 })).status).toBe(200);

    const { data } = await waitForSucceeded(start.attemptId);
    const assessment = assessmentAttemptSchema.parse(data).assessments[0];
    expect(assessment.skill).toBe("speaking");
    expect(assessment.status).toBe("SUCCEEDED");
    expect(assessment.aiScore).toBeGreaterThan(0);
    const submission = assessment.submissions[0];
    expect(submission.audioUrl).toContain(`/mock/attempts/${start.attemptId}/speaking/${question.id}`);
    expect(submission.transcript?.text).toBeTruthy();
    expect(submission.transcript?.pronunciationEvidence).toBe("UNAVAILABLE");
  });

  it("404s an unknown attempt instead of inventing feedback", async () => {
    const r = await readAssessment("matt-does-not-exist");
    expect(r.status).toBe(404);
    expect(r.json.error?.code).toBe("ATTEMPT_NOT_FOUND");
  });

  it("requires an authenticated caller before the attempt is looked up", async () => {
    const r = await api("/assessment/attempts/matt-does-not-exist");
    expect(r.status).toBe(401);
    expect(r.json.error?.code).toBe("UNAUTHORIZED");
  });
});
