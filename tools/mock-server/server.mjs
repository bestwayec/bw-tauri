#!/usr/bin/env node
/**
 * Local mock backend for Bestway Exam desktop development + integration tests.
 *
 * Plain Node.js, zero dependencies. Implements just enough of the backend
 * contract (see backend/api-contract.md in the bestway monorepo) to develop
 * and verify the desktop client WITHOUT the real backend:
 *
 * - Auth with 15-minute access tokens (unsigned JWT-shaped, `exp` enforced),
 *   ROTATING refresh tokens with reuse detection: presenting an already-used
 *   refresh token revokes the WHOLE family -> 401 SESSION_EXPIRED.
 * - Mock exams covering ALL 15 question types, gapped contentHtml docs,
 *   auth-protected media, HTTP Range audio, ?attemptId= replay counting.
 * - Legacy /tests flow, heartbeat, flag-cheat, desktop-version.
 *
 * Usage:
 *   node tools/mock-server/server.mjs [--port 3101]
 *   # then point the app at it:
 *   VITE_API_URL=http://127.0.0.1:3101/v1 npm run dev
 *
 * This is DEV-ONLY infrastructure: no signatures, no rate limits, in-memory.
 */

import http from "node:http";

const PORT = Number(process.argv.find((a) => a.startsWith("--port="))?.split("=")[1] ?? process.env.MOCK_PORT ?? 3101);
const ACCESS_TTL_S = 15 * 60;
const REFRESH_TTL_S = 30 * 24 * 3600;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const b64url = (obj) =>
  Buffer.from(JSON.stringify(obj)).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const fromB64url = (s) => JSON.parse(Buffer.from(s.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString());
const rid = (p) => `${p}-${Math.random().toString(36).slice(2, 10)}`;

function send(res, status, data, meta) {
  const body = JSON.stringify({ success: status < 400, data, ...(meta ? { meta } : {}) });
  res.writeHead(status, { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) });
  res.end(body);
}
const ok = (res, data, meta) => send(res, 200, data, meta);
const fail = (res, status, code, message) => {
  const body = JSON.stringify({ success: false, error: { code, message } });
  res.writeHead(status, { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) });
  res.end(body);
};

function readBody(req) {
  return new Promise((resolve) => {
    let chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString() || "{}"));
      } catch {
        resolve({});
      }
    });
  });
}

// ---------------------------------------------------------------------------
// Auth state: rotation with reuse detection
// ---------------------------------------------------------------------------

const users = {
  "stu-1": { id: "stu-1", phone: "+998900000010", password: "Student123!", name: "Mock Student", role: "student" },
};
const byPhone = { "+998900000010": users["stu-1"] };
// refreshToken -> { family, userId, used, exp }
const refreshTokens = new Map();
// familyId -> { userId, valid }
const families = new Map();

function mintAccess(userId, ttlS = ACCESS_TTL_S) {
  const exp = Math.floor(Date.now() / 1000) + ttlS;
  return `${b64url({ alg: "none", typ: "JWT" })}.${b64url({ sub: userId, exp, jti: rid("jti") })}.mock`;
}

function verifyAccess(token) {
  try {
    const [h, p] = token.split(".");
    if (!h || !p) return null;
    const payload = fromB64url(p);
    if (!payload.sub || !users[payload.sub]) return null;
    if (typeof payload.exp === "number" && payload.exp * 1000 < Date.now()) return null;
    return payload.sub;
  } catch {
    return null;
  }
}

function mintPair(userId) {
  const family = rid("fam");
  families.set(family, { userId, valid: true });
  const rt = rid("rt");
  refreshTokens.set(rt, { family, userId, used: false, exp: Date.now() + REFRESH_TTL_S * 1000 });
  return { accessToken: mintAccess(userId), refreshToken: rt };
}

function rotate(refreshToken) {
  const rec = refreshTokens.get(refreshToken);
  if (!rec || rec.exp < Date.now()) return { error: "INVALID_REFRESH_TOKEN" };
  const fam = families.get(rec.family);
  if (!fam || !fam.valid) return { error: "SESSION_EXPIRED" };
  if (rec.used) {
    // Reuse detected: revoke the WHOLE family, no grace window.
    fam.valid = false;
    for (const [tok, r] of refreshTokens) if (r.family === rec.family) refreshTokens.delete(tok);
    return { error: "SESSION_EXPIRED" };
  }
  rec.used = true;
  const rt = rid("rt");
  refreshTokens.set(rt, { family: rec.family, userId: rec.userId, used: false, exp: Date.now() + REFRESH_TTL_S * 1000 });
  return { accessToken: mintAccess(rec.userId), refreshToken: rt };
}

function bearer(req) {
  const h = req.headers.authorization ?? "";
  const m = h.match(/^Bearer (.+)$/);
  return m ? verifyAccess(m[1].trim()) : null;
}

// ---------------------------------------------------------------------------
// Exam content: all 15 question types
// ---------------------------------------------------------------------------

let n = 0;
const Q = (type, prompt, extra = {}) => ({ id: `mq-${++n}`, number: n, sortOrder: n, type, prompt, ...extra });
const G = (over) => ({
  id: rid("grp"),
  sortOrder: 0,
  title: null,
  instructions: null,
  passageText: null,
  contentHtml: null,
  contentLayout: null,
  hasAudio: false,
  audioUrl: null,
  imageUrl: null,
  partNumber: null,
  audioDurationSec: null,
  audioPlayLimit: 1,
  questions: [],
  ...over,
});

const readingGroups = [
  G({
    title: "Notes",
    instructions: "Complete the notes below. Choose ONE WORD ONLY from the passage for each answer.",
    passageText: "Passage about bees. Bees live in hives and make honey. They fly many kilometres.",
    contentHtml:
      "<h4>Notes</h4><p>Bees live in <span data-gap=\"1\"></span> and make <span data-gap=\"2\"></span>.</p>",
    questions: [
      Q("note_completion", "Bees live in …", { points: 1, wordLimit: 1 }),
      Q("note_completion", "Bees make …", { points: 1, wordLimit: 1 }),
    ],
  }),
  G({
    title: "Summary",
    instructions: "Complete the summary. Choose ONE WORD ONLY.",
    contentHtml: "<p>Hives need <span data-gap=\"3\"></span> daily.</p>",
    questions: [Q("summary_completion", "Hives need … daily.", { points: 1, wordLimit: 1 })],
  }),
  G({
    title: "Table",
    instructions: "Complete the table. NO MORE THAN TWO WORDS.",
    contentHtml:
      "<table><tbody><tr><td>Rooms</td><td><span data-gap=\"4\"></span></td></tr></tbody></table>",
    questions: [Q("table_completion", "Rooms …", { points: 1, wordLimit: 2 })],
  }),
  G({
    title: "Statements",
    questions: [
      Q("true_false_notgiven", "Bees are mammals.", { points: 1 }),
      Q("yes_no_notgiven", "The author likes honey.", { points: 1 }),
      Q("multiple_choice", "Where do bees live?", { options: ["Hives", "Caves", "Nests"], points: 1 }),
      Q("multi_select", "Choose TWO true statements.", { options: ["A", "B", "C"], points: 2 }),
      Q("matching", "Match the paragraph to the heading.", { options: ["Heading A", "Heading B"], points: 1 }),
      Q("matching_headings", "Choose the heading.", { options: ["H1", "H2", "H3"], points: 1 }),
      Q("sentence_completion", "Bees fly ____ kilometres.", { points: 1, wordLimit: 2 }),
      Q("short_answer", "What do bees make?", { points: 1, wordLimit: 2 }),
    ],
  }),
  G({
    id: "map-group",
    title: "Map",
    instructions: "Label the map. Choose letters.",
    imageUrl: "/v1/mock/groups/map-group/image",
    questions: [Q("map_labelling", "The hive is at …", { options: ["A", "B", "C"], points: 1 })],
  }),
];
// Renumber sequentially + fix gap tokens to match question numbers.
(() => {
  let num = 0;
  for (const g of readingGroups) {
    for (const q of g.questions) {
      num++;
      q.number = num;
      q.sortOrder = num;
    }
    if (g.contentHtml) {
      let i = 0;
      const nums = g.questions.map((q) => q.number);
      g.contentHtml = g.contentHtml.replace(/<span\s+data-gap="\d+"[^>]*>[\s\S]*?<\/span>/g, () => `<span data-gap="${nums[i++]}"></span>`);
    }
  }
})();

const listeningGroups = [
  G({
    id: "audio-group",
    title: "Part 1",
    hasAudio: true,
    audioUrl: "/v1/mock/groups/audio-group/audio",
    audioDurationSec: 30,
    audioPlayLimit: 1,
    instructions: "Answer questions 1-2.",
    questions: [
      Q("multiple_choice", "What time is it?", { options: ["One", "Two"], points: 1 }),
      Q("note_completion", "The meeting is at …", { points: 1, wordLimit: 2 }),
    ],
  }),
];
const writingGroups = [
  G({ title: "Task 1", questions: [Q("essay_task1", "Describe the chart.", { points: 20 })] }),
  G({ title: "Task 2", questions: [Q("essay_task2", "Discuss both views.", { points: 40 })] }),
];
const speakingGroups = [G({ title: "Part 1", questions: [Q("speaking_task", "Talk about your home.", { points: 10 })] })];

const mockExam = {
  id: "mock-1",
  type: "ielts_academic",
  title: "Mock Server Full Test",
  description: "Covers all 15 question types.",
  level: "Academic",
  isPublished: true,
  isDemo: true,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  questionCount: 0,
  price: 0,
  access: "granted",
  skills: ["listening", "reading", "writing", "speaking"],
  sections: [
    { id: "sec-l", skill: "listening", title: "Listening", sortOrder: 0, durationMinutes: null, instructions: null, groups: listeningGroups },
    { id: "sec-r", skill: "reading", title: "Reading", sortOrder: 1, durationMinutes: 60, instructions: null, groups: readingGroups },
    { id: "sec-w", skill: "writing", title: "Writing", sortOrder: 2, durationMinutes: 60, instructions: null, groups: writingGroups },
    { id: "sec-s", skill: "speaking", title: "Speaking", sortOrder: 3, durationMinutes: null, instructions: null, groups: speakingGroups },
  ],
};
mockExam.questionCount = mockExam.sections.reduce((s, x) => s + x.groups.reduce((a, g) => a + g.questions.length, 0), 0);
for (const s of mockExam.sections) s.groups.forEach((g, i) => ((g.sortOrder = i), (g.partNumber = i + 1)));

const legacyTest = {
  id: "test-1",
  type: "ielts",
  title: "Mock Server Legacy Test",
  level: "B2",
  isDemo: true,
  isActive: true,
  durationMinutes: 30,
  questionCount: 2,
  sections: ["reading"],
};

const attempts = new Map(); // attemptId -> { examId|testId, kind, studentId, mode, answers:Map, status, startedAt }
const audioPlays = new Map(); // `${groupId}:${attemptId}` -> count

// Deterministic fake audio (32KB) + 1px PNG.
const AUDIO = Buffer.alloc(32 * 1024);
for (let i = 0; i < AUDIO.length; i++) AUDIO[i] = i % 256;
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

function shapeGroup(g, base) {
  return {
    ...g,
    audioUrl: g.hasAudio ? `${base}/mock/groups/${g.id}/audio` : null,
    imageUrl: g.imageUrl ? `${base}${g.imageUrl}` : null,
    questions: g.questions.map((q) => ({
      id: q.id,
      number: q.number,
      sortOrder: q.sortOrder,
      type: q.type,
      prompt: q.prompt,
      options: q.options ?? null,
      points: q.points,
      wordLimit: q.wordLimit ?? null,
    })),
  };
}

function shapeExamForStudent(base) {
  return {
    ...mockExam,
    sections: mockExam.sections.map((s) => ({ ...s, groups: s.groups.map((g) => shapeGroup(g, base)) })),
  };
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

const server = http.createServer(async (req, res) => {
  const u = new URL(req.url ?? "/", "http://x");
  const path = u.pathname;
  const method = req.method ?? "GET";
  const body = method === "GET" || method === "HEAD" ? {} : await readBody(req);
  const base = `http://127.0.0.1:${PORT}/v1`;

  // --- auth (public) ---
  if (method === "POST" && path === "/v1/auth/login") {
    const user = byPhone[body.phone];
    if (!user || user.password !== body.password) return fail(res, 401, "INVALID_CREDENTIALS", "Wrong phone or password");
    const pair = mintPair(user.id);
    return ok(res, { user: { id: user.id, phone: user.phone, name: user.name, role: user.role }, ...pair });
  }
  if (method === "POST" && path === "/v1/auth/refresh") {
    const r = rotate(body.refreshToken);
    if (r.error) {
      const code = r.error;
      return fail(res, 401, code, code === "SESSION_EXPIRED" ? "Session expired, sign in again" : "Invalid refresh token");
    }
    return ok(res, r);
  }
  if (method === "POST" && path === "/v1/auth/logout") return ok(res, { revoked: true });
  if (method === "POST" && path === "/v1/auth/desktop/exchange") {
    if (body.code !== "test-code") return fail(res, 400, "INVALID_DESKTOP_CODE", "Bad code");
    const pair = mintPair("stu-1");
    const user = users["stu-1"];
    return ok(res, { user: { id: user.id, role: user.role }, ...pair });
  }

  // --- everything below needs a valid access token ---
  const userId = bearer(req);
  if (!userId) {
    // Like the real backend: guests see demo tests only, no mocks, but demo
    // group media stays public so players can probe it.
    if (method === "GET" && path === "/v1/tests") return ok(res, [legacyTest], { page: 1, limit: 50, total: 1 });
    if (method === "GET" && path === "/v1/mock/exams") return ok(res, []);
    const demoMedia = /\/v1\/mock\/groups\/(audio-group|map-group)\/(audio|image)/.test(path);
    if (!demoMedia) return fail(res, 401, "UNAUTHORIZED", "Missing or expired access token");
  }
  const me = users[userId ?? "stu-1"];

  if (method === "GET" && path === "/v1/auth/me") {
    return ok(res, { user: { id: me.id, phone: me.phone, name: me.name, role: me.role } });
  }
  if (method === "GET" && path === "/v1/desktop-version") {
    return ok(res, { version: "9.9.9", downloadUrl: null });
  }

  // --- legacy tests ---
  if (method === "GET" && path === "/v1/tests") {
    return ok(res, [legacyTest], { page: 1, limit: 50, total: 1 });
  }
  let m = path.match(/^\/v1\/tests\/([^/]+)\/start$/);
  if (method === "POST" && m) {
    const id = rid("tatt");
    attempts.set(id, { kind: "test", testId: "test-1", studentId: userId, status: "in_progress", answers: new Map(), startedAt: new Date().toISOString() });
    return ok(res, {
      attemptId: id,
      resumed: false,
      durationMinutes: 30,
      startedAt: new Date().toISOString(),
      questions: [
        { id: "tq-1", section: "reading", type: "short_answer", prompt: "What?", options: null, maxScore: 1 },
        { id: "tq-2", section: "reading", type: "multiple_choice", prompt: "Pick.", options: ["A", "B"], maxScore: 1 },
      ],
      savedAnswers: {},
    });
  }
  m = path.match(/^\/v1\/tests\/attempts\/([^/]+)\/answer$/);
  if (method === "POST" && m) {
    const a = attempts.get(m[1]);
    if (!a) return fail(res, 404, "ATTEMPT_NOT_FOUND", "No such attempt");
    a.answers.set(body.questionId, body.response ?? "");
    return ok(res, { saved: true });
  }
  m = path.match(/^\/v1\/tests\/attempts\/([^/]+)\/submit$/);
  if (method === "POST" && m) {
    const a = attempts.get(m[1]);
    if (!a) return fail(res, 404, "ATTEMPT_NOT_FOUND", "No such attempt");
    a.status = "completed";
    return ok(res, { status: "completed", autoScore: 1 });
  }
  if (method === "GET" && path === "/v1/tests/attempts/mine") {
    return ok(res, [...attempts.entries()].filter(([, a]) => a.kind === "test" && a.studentId === userId).map(([id, a]) => ({ id, status: a.status, autoScore: null, totalScore: null, startedAt: a.startedAt, finishedAt: null })));
  }

  // --- mock exams ---
  if (method === "GET" && path === "/v1/mock/exams") {
    const { skills, questionCount, sections, ...rest } = shapeExamForStudent(base);
    void skills;
    void questionCount;
    return ok(res, [{ ...rest, skills: mockExam.skills, questionCount: mockExam.questionCount, durationMinutes: 60, price: 0, access: "granted" }]);
  }
  m = path.match(/^\/v1\/mock\/exams\/([^/]+)\/start$/);
  if (method === "POST" && m) {
    for (const [id, a] of attempts) {
      if (a.kind === "mock" && a.studentId === userId && a.status === "in_progress") {
        return ok(res, startPayload(id, a, body.mode ?? "practice"));
      }
    }
    const id = rid("matt");
    const a = { kind: "mock", examId: "mock-1", studentId: userId, mode: body.mode ?? "practice", status: "in_progress", answers: new Map(), startedAt: new Date().toISOString() };
    attempts.set(id, a);
    return ok(res, startPayload(id, a, a.mode));
  }
  m = path.match(/^\/v1\/mock\/attempts\/([^/]+)\/answer$/);
  if (method === "POST" && m) {
    const a = attempts.get(m[1]);
    if (!a) return fail(res, 404, "ATTEMPT_NOT_FOUND", "No such attempt");
    a.answers.set(body.questionId, body.response ?? "");
    return ok(res, { saved: true });
  }
  m = path.match(/^\/v1\/mock\/attempts\/([^/]+)\/answers$/);
  if (method === "POST" && m) {
    const a = attempts.get(m[1]);
    if (!a) return fail(res, 404, "ATTEMPT_NOT_FOUND", "No such attempt");
    const list = Array.isArray(body.answers) ? body.answers.slice(0, 200) : [];
    for (const it of list) a.answers.set(it.questionId, it.response ?? "");
    return ok(res, { saved: list.length });
  }
  m = path.match(/^\/v1\/mock\/attempts\/([^/]+)\/speaking\/([^/]+)$/);
  if (method === "POST" && m) {
    const a = attempts.get(m[1]);
    if (!a) return fail(res, 404, "ATTEMPT_NOT_FOUND", "No such attempt");
    a.answers.set(m[2], "[audio]");
    return ok(res, { saved: true, audioUrl: `${base}/mock/attempts/${m[1]}/speaking/${m[2]}` });
  }
  m = path.match(/^\/v1\/mock\/attempts\/([^/]+)\/submit$/);
  if (method === "POST" && m) {
    const a = attempts.get(m[1]);
    if (!a) return fail(res, 404, "ATTEMPT_NOT_FOUND", "No such attempt");
    if (a.status !== "in_progress") return fail(res, 400, "MOCK_ATTEMPT_FINISHED", "Already submitted");
    a.status = "completed";
    const skills = Array.isArray(body.skills) && body.skills.length ? body.skills : ["listening", "reading", "writing", "speaking"];
    const rawScores = {};
    for (const s of skills) rawScores[s] = { score: a.answers.size, max: 10 };
    return ok(res, { status: "completed", rawScores, sectionBands: { reading: 6.5 }, overallBand: 6.5, cefrLevel: "B2" });
  }
  m = path.match(/^\/v1\/mock\/attempts\/([^/]+)\/flag-cheat$/);
  if (method === "POST" && m) return ok(res, { flagged: true });
  if (method === "GET" && path === "/v1/mock/attempts/mine") {
    return ok(res, [...attempts.entries()].filter(([, a]) => a.kind === "mock").map(([id, a]) => ({ id, status: a.status })));
  }
  m = path.match(/^\/v1\/mock\/groups\/([^/]+)\/audio$/);
  if (method === "GET" && m) {
    const attemptId = u.searchParams.get("attemptId");
    if (attemptId) audioPlays.set(`${m[1]}:${attemptId}`, (audioPlays.get(`${m[1]}:${attemptId}`) ?? 0) + 1);
    const range = req.headers.range;
    if (range) {
      const rm = range.match(/bytes=(\d+)-(\d*)/);
      const start = rm ? Number(rm[1]) : 0;
      const end = rm && rm[2] ? Math.min(Number(rm[2]), AUDIO.length - 1) : AUDIO.length - 1;
      res.writeHead(206, {
        "Content-Type": "audio/mpeg",
        "Content-Length": end - start + 1,
        "Content-Range": `bytes ${start}-${end}/${AUDIO.length}`,
        "Accept-Ranges": "bytes",
      });
      return res.end(AUDIO.subarray(start, end + 1));
    }
    res.writeHead(200, { "Content-Type": "audio/mpeg", "Content-Length": AUDIO.length, "Accept-Ranges": "bytes" });
    return res.end(AUDIO);
  }
  m = path.match(/^\/v1\/mock\/groups\/([^/]+)\/image$/);
  if (method === "GET" && m) {
    res.writeHead(200, { "Content-Type": "image/png", "Content-Length": PNG.length });
    return res.end(PNG);
  }

  if (method === "POST" && path === "/v1/exam-desktop/heartbeat") return ok(res, { received: true });
  return fail(res, 404, "NOT_FOUND", `No mock route ${method} ${path}`);

  function startPayload(id, a, mode) {
    const saved = {};
    for (const [k, v] of a.answers) saved[k] = v;
    return {
      attemptId: id,
      resumed: a.answers.size > 0,
      mode,
      startedAt: a.startedAt,
      deadlineAt: null,
      serverTime: new Date().toISOString(),
      durationMinutes: null,
      flowMode: "single_skill",
      currentSkill: null,
      sectionDeadlines: null,
      overallDeadlineAt: null,
      exam: shapeExamForStudent(base),
      annotations: [],
      savedAnswers: saved,
    };
  }
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`mock-server listening on http://127.0.0.1:${PORT}/v1`);
});
