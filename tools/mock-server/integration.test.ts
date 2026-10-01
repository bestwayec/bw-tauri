/**
 * Contract + flow integration test against tools/mock-server (spawns it).
 *
 * login -> list (tests + mocks w/ access) -> start -> autosave (single+bulk)
 * -> Range/image media -> token expiry -> refresh rotation + reuse detection
 * -> section submit -> offline/online reconnect.
 *
 * Uses raw fetch (not the app client): this verifies the SERVER contract the
 * app codes against. App-side retry/single-flight logic is unit-tested in
 * src/lib/session-store.test.ts.
 */
import { spawn, type ChildProcess } from "node:child_process";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const PORT = 3109;
const BASE = `http://127.0.0.1:${PORT}/v1`;
const SERVER = path.resolve(import.meta.dirname, "./server.mjs");

let proc: ChildProcess | null = null;

function startServer(): ChildProcess {
  const p = spawn(process.execPath, [SERVER, `--port=${PORT}`], { stdio: "ignore" });
  proc = p;
  return p;
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
  headers: Headers;
  bytes: Uint8Array;
}

async function api(
  path: string,
  init: { method?: string; token?: string | null; body?: unknown; headers?: Record<string, string> } = {},
): Promise<ApiResult> {
  const res = await fetch(`${BASE}${path}`, {
    method: init.method ?? "GET",
    headers: {
      ...(init.body !== undefined ? { "Content-Type": "application/json" } : {}),
      ...(init.token ? { Authorization: `Bearer ${init.token}` } : {}),
      ...(init.headers ?? {}),
    },
    body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
  });
  const buf = new Uint8Array(await res.arrayBuffer());
  let json: ApiResult["json"] = {};
  try {
    json = JSON.parse(Buffer.from(buf).toString()) as ApiResult["json"];
  } catch {
    /* binary media */
  }
  return { status: res.status, json, headers: res.headers, bytes: buf };
}

const b64url = (o: unknown) =>
  Buffer.from(JSON.stringify(o)).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

/** Craft an EXPIRED access token (mock server uses unsigned JWTs, like the client expects). */
function expiredToken(): string {
  return `${b64url({ alg: "none" })}.${b64url({ sub: "stu-1", exp: Math.floor(Date.now() / 1000) - 60 })}.mock`;
}

let access = "";
let refresh = "";
let attemptId = "";
let firstQuestionId = "";

beforeAll(async () => {
  startServer();
  await waitUp();
}, 60_000);

afterAll(async () => {
  proc?.kill();
  proc = null;
});

describe("auth + rotation", () => {
  it("rejects bad credentials", async () => {
    const r = await api("/auth/login", { method: "POST", body: { phone: "+998900000010", password: "nope" } });
    expect(r.status).toBe(401);
    expect(r.json.error?.code).toBe("INVALID_CREDENTIALS");
  });

  it("logs in and issues a 15-minute access token", async () => {
    const r = await api("/auth/login", {
      method: "POST",
      body: { phone: "+998900000010", password: "Student123!" },
    });
    expect(r.status).toBe(200);
    const data = r.json.data as { accessToken: string; refreshToken: string; user: { id: string } };
    access = data.accessToken;
    refresh = data.refreshToken;
    expect(data.user.id).toBe("stu-1");
    const exp = JSON.parse(Buffer.from(access.split(".")[1].replace(/-/g, "+").replace(/_/g, "/"), "base64").toString()) as {
      exp: number;
    };
    expect(exp.exp * 1000 - Date.now()).toBeGreaterThan(14 * 60_000);
  });

  it("expired access tokens 401 and refresh rotates the pair", async () => {
    const dead = await api("/auth/me", { token: expiredToken() });
    expect(dead.status).toBe(401);
    const r = await api("/auth/refresh", { method: "POST", body: { refreshToken: refresh } });
    expect(r.status).toBe(200);
    const data = r.json.data as { accessToken: string; refreshToken: string };
    expect(data.accessToken).not.toBe(access);
    access = data.accessToken;
    refresh = data.refreshToken;
    const me = await api("/auth/me", { token: access });
    expect(me.status).toBe(200);
  });
});

describe("listing", () => {
  it("guests see demo tests only and no mocks", async () => {
    const t = await api("/tests?limit=50");
    expect(t.status).toBe(200);
    expect((t.json.data as unknown[]).length).toBeGreaterThan(0);
    const m = await api("/mock/exams");
    expect(m.status).toBe(200);
    expect(m.json.data).toEqual([]);
  });

  it("students see tests and mocks with access states", async () => {
    const t = await api("/tests?limit=50", { token: access });
    expect(((t.json.data as unknown[])?.length ?? 0)).toBeGreaterThan(0);
    const m = await api("/mock/exams", { token: access });
    const items = m.json.data as Array<{ access: string; questionCount: number; isPublished: boolean }>;
    expect(items.length).toBeGreaterThan(0);
    expect(["granted", "pending", "locked"]).toContain(items[0].access);
  });
});

describe("mock flow", () => {
  it("starts (or resumes) and ships gapped contentHtml", async () => {
    const mocks = (await api("/mock/exams", { token: access })).json.data as Array<{ id: string }>;
    const r = await api(`/mock/exams/${mocks[0].id}/start`, {
      method: "POST",
      token: access,
      body: { mode: "practice", flow: "single_skill" },
    });
    expect(r.status).toBe(200);
    const data = r.json.data as {
      attemptId: string;
      serverTime: string;
      exam: { sections: Array<{ groups: Array<{ contentHtml: string | null; questions: Array<{ id: string }> }> }> };
    };
    attemptId = data.attemptId;
    expect(typeof data.serverTime).toBe("string");
    const docs = data.exam.sections.flatMap((s) => s.groups).filter((g) => g.contentHtml);
    expect(docs.length).toBeGreaterThan(0);
    expect(docs[0].contentHtml).toMatch(/data-gap="\d+"/);
    firstQuestionId = data.exam.sections[0].groups[0].questions[0].id;
    // All 15 backend types exist somewhere in the exam.
    const types = new Set(
      data.exam.sections.flatMap((s) => s.groups.flatMap((g) => g.questions.map((q) => (q as { type: string }).type))),
    );
    for (const t of [
      "multiple_choice",
      "multi_select",
      "true_false_notgiven",
      "yes_no_notgiven",
      "matching",
      "matching_headings",
      "sentence_completion",
      "note_completion",
      "summary_completion",
      "table_completion",
      "short_answer",
      "map_labelling",
      "essay_task1",
      "essay_task2",
      "speaking_task",
    ]) {
      expect(types.has(t), `missing type ${t}`).toBe(true);
    }
  });

  it("autosaves single + bulk answers", async () => {
    const one = await api(`/mock/attempts/${attemptId}/answer`, {
      method: "POST",
      token: access,
      body: { questionId: firstQuestionId, response: "hives" },
    });
    expect((one.json.data as { saved: boolean }).saved).toBe(true);
    const bulk = await api(`/mock/attempts/${attemptId}/answers`, {
      method: "POST",
      token: access,
      body: { answers: [{ questionId: firstQuestionId, response: "hives" }] },
    });
    expect((bulk.json.data as { saved: number }).saved).toBe(1);
  });

  it("serves Range audio and images", async () => {
    const full = await api("/mock/groups/audio-group/audio", { token: access });
    expect(full.status).toBe(200);
    expect(full.headers.get("accept-ranges")).toBe("bytes");
    const part = await api("/mock/groups/audio-group/audio", {
      token: access,
      headers: { Range: "bytes=0-99" },
    });
    expect(part.status).toBe(206);
    expect(part.bytes.length).toBe(100);
    expect(part.headers.get("content-range")).toMatch(/^bytes 0-99\//);
    const img = await api("/mock/groups/map-group/image", { token: access });
    expect(img.status).toBe(200);
    expect(img.headers.get("content-type")).toBe("image/png");
  });

  it("submits a section and rejects double submit", async () => {
    const s = await api(`/mock/attempts/${attemptId}/submit`, {
      method: "POST",
      token: access,
      body: { skills: ["reading"] },
    });
    expect(s.status).toBe(200);
    expect((s.json.data as { status: string }).status).toBe("completed");
    const again = await api(`/mock/attempts/${attemptId}/submit`, {
      method: "POST",
      token: access,
      body: { skills: ["reading"] },
    });
    expect(again.status).toBe(400);
    expect(again.json.error?.code).toBe("MOCK_ATTEMPT_FINISHED");
  });
});

describe("reuse detection", () => {
  it("re-presenting a used refresh token revokes the family", async () => {
    // `refresh` was already rotated once in the rotation test.
    const replay = await api("/auth/refresh", { method: "POST", body: { refreshToken: refresh } });
    expect(replay.status).toBe(200);
    const stale = refresh;
    refresh = (replay.json.data as { refreshToken: string }).refreshToken;
    // Present the now-used token again -> family revoked.
    const reuse = await api("/auth/refresh", { method: "POST", body: { refreshToken: stale } });
    expect(reuse.status).toBe(401);
    expect(reuse.json.error?.code).toBe("SESSION_EXPIRED");
    // Even the newest token of the revoked family is dead.
    const after = await api("/auth/refresh", { method: "POST", body: { refreshToken: refresh } });
    expect(after.status).toBe(401);
    // Fresh login works again.
    const login = await api("/auth/login", {
      method: "POST",
      body: { phone: "+998900000010", password: "Student123!" },
    });
    expect(login.status).toBe(200);
  });
});

describe("offline/online reconnect", () => {
  it("survives a server restart and keeps serving after reconnect", async () => {
    proc?.kill();
    proc = null;
    await expect(fetch(`${BASE}/auth/me`)).rejects.toThrow();
    startServer();
    await waitUp();
    const login = await api("/auth/login", {
      method: "POST",
      body: { phone: "+998900000010", password: "Student123!" },
    });
    expect(login.status).toBe(200);
  }, 60_000);
});
