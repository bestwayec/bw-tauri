/**
 * Phase 5 verification: real mock-server payloads must flow through the
 * DESKTOP zod schemas and adapters with zero SCHEMA_MISMATCH — i.e. the
 * IELTS UI renders mock-server data, not just fixtures.
 */
import { spawn, type ChildProcess } from "node:child_process";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { mockSectionToParts } from "@/components/exam-ui/model";
import { gapNumbersIn } from "@/components/exam/GappedContent";
import { MockExamListSchema, MockStartResultSchema, parseOrThrow } from "@/lib/schemas";
import { mockGroupAudioUrl } from "@/lib/mocks";

// The fixtures contain absolute loopback media URLs. Match the test backend
// explicitly so the same-origin security policy is exercised rather than
// silently dropping every media source while the adapter assertions pass.
vi.mock("@/lib/config", async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/config')>()),
  API_BASE_URL: 'http://127.0.0.1:3111/v1',
}));

const PORT = 3111;
const BASE = `http://127.0.0.1:${PORT}/v1`;
const SERVER = path.resolve(import.meta.dirname, "./server.mjs");

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

async function authed(pathname: string, token: string, init?: RequestInit) {
  const res = await fetch(`${BASE}${pathname}`, {
    ...init,
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}`, ...(init?.headers ?? {}) },
  });
  const json = (await res.json()) as { success: boolean; data: unknown };
  if (!res.ok || !json.success) throw new Error(`HTTP ${res.status} on ${pathname}`);
  return json.data;
}

beforeAll(async () => {
  proc = spawn(process.execPath, [SERVER, `--port=${PORT}`], { stdio: "ignore" });
  await waitUp();
}, 60_000);

afterAll(async () => {
  proc?.kill();
  proc = null;
});

describe("desktop schemas accept mock-server payloads", () => {
  it("GET /mock/exams validates", async () => {
    const login = (await authed("/auth/login", "", {
      method: "POST",
      body: JSON.stringify({ phone: "+998900000010", password: "Student123!" }),
    })) as { accessToken: string };
    const raw = await authed("/mock/exams", login.accessToken);
    const items = parseOrThrow("GET /mock/exams", MockExamListSchema, raw);
    expect(items.length).toBeGreaterThan(0);
    expect(items[0].access).toBe("granted");
  });

  it("start payload validates and adapts into runner parts", async () => {
    const login = (await authed("/auth/login", "", {
      method: "POST",
      body: JSON.stringify({ phone: "+998900000010", password: "Student123!" }),
    })) as { accessToken: string };
    const exams = (await authed("/mock/exams", login.accessToken)) as Array<{ id: string }>;
    const raw = await authed(`/mock/exams/${exams[0].id}/start`, login.accessToken, {
      method: "POST",
      body: JSON.stringify({ mode: "practice", flow: "single_skill" }),
    });
    const start = parseOrThrow("POST /mock/exams/:id/start", MockStartResultSchema, raw);
    expect(start.exam.questionCount).toBeGreaterThan(0);

    let total = 0;
    let gapped = 0;
    for (const section of start.exam.sections) {
      const parts = mockSectionToParts(section, start.attemptId, false);
      expect(parts.length).toBe(section.groups.length);
      for (let i = 0; i < parts.length; i++) {
        expect(parts[i].questions.length).toBe(section.groups[i].questions.length);
        total += parts[i].questions.length;
        if (parts[i].contentHtml) {
          gapped++;
          // Every gap token maps to a real question in the same part.
          const nums = new Set(parts[i].questions.map((q) => q.number));
          for (const n of gapNumbersIn(parts[i].contentHtml!)) {
            expect(nums.has(n), `orphan gap ${n}`).toBe(true);
          }
        }
        // Practice mode never arms strict audio.
        expect(parts[i].strictAudio).toBe(false);
        if (section.groups[i].hasAudio) {
          expect(parts[i].audioUrl).toContain(`${BASE}/mock/groups/`);
        }
      }
    }
    expect(total).toBe(start.exam.questionCount);
    expect(gapped).toBeGreaterThan(0);
  });

  it("strict audio URLs carry attemptId for replay counting", () => {
    const url = mockGroupAudioUrl({ audioUrl: "/v1/mock/groups/g/audio" }, "att-1", true);
    expect(url).toContain("attemptId=att-1");
    const lax = mockGroupAudioUrl({ audioUrl: "/v1/mock/groups/g/audio" }, "att-1", false);
    expect(lax).not.toContain("attemptId");
  });
});
