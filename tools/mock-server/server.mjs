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
 * - AI assessment feedback for Writing/Speaking submits, served at
 *   GET /v1/assessment/attempts/:id (PENDING -> PROCESSING -> SUCCEEDED).
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
  // A full-test blueprint: `full_test` flow and the start picker's Full Mock
  // action are only offered for `full_mock` exams (backend rule).
  profile: "full_mock",
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

// Server-owned exam track (mirrors GET/PATCH /exam-programs/mine).
let activeProgram = "MULTILEVEL";
const attempts = new Map(); // attemptId -> { examId|testId, kind, studentId, mode, answers:Map, status, startedAt }
const audioPlays = new Map(); // `${groupId}:${attemptId}` -> count
const assessmentJobs = new Map(); // attemptId -> [job] (AI Writing/Speaking feedback)

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

const SKILLS = ["listening", "reading", "writing", "speaking"];

/**
 * Shape the exam for a student. `scope` (a single skill) narrows the payload
 * to that one section — the real backend scopes single-section practice
 * attempts the same way, so the other sections are never downloaded.
 */
function shapeExamForStudent(base, scope = null) {
  const sections = scope ? mockExam.sections.filter((s) => s.skill === scope) : mockExam.sections;
  const shaped = {
    ...mockExam,
    sections: sections.map((s) => ({ ...s, groups: s.groups.map((g) => shapeGroup(g, base)) })),
  };
  shaped.questionCount = shaped.sections.reduce((s, x) => s + x.groups.reduce((a, g) => a + g.questions.length, 0), 0);
  return shaped;
}

/**
 * Single-section practice is requested with `section`, `section_filter` or a
 * one-element `skills` array; anything unrecognised means "no scope".
 */
function requestedScope(source) {
  const raw = source.section ?? source.section_filter ??
    (Array.isArray(source.skills) && source.skills.length === 1 ? source.skills[0] : null);
  const skill = typeof raw === "string" ? raw.trim().toLowerCase() : "";
  return SKILLS.includes(skill) ? skill : null;
}

// ---------------------------------------------------------------------------
// AI assessment fixture (Writing / Speaking feedback)
// ---------------------------------------------------------------------------
// Mirrors the real backend: `POST /mock/attempts/:id/submit` enqueues one job
// per Writing/Speaking skill in the graded scope, and
// `GET /assessment/attempts/:id` reports them. The client contract lives in
// src/lib/assessment.ts (`assessmentAttemptSchema`) — this fixture must keep
// validating against it and must never leak provider-only fields.

const ASSESSMENT_PROGRAMS = {
  ielts_academic: "IELTS_ACADEMIC",
  ielts_general: "IELTS_GENERAL",
  multilevel: "MULTILEVEL",
};
const ASSESSMENT_SKILLS = ["writing", "speaking"];
const ASSESSMENT_DEFAULT_DELAY_MS = 1500;

/** Test hook: shorten the simulated AI latency (0..60s, default 1.5s). */
function assessmentDelayMs(raw) {
  const value = Number(raw);
  if (!Number.isFinite(value)) return ASSESSMENT_DEFAULT_DELAY_MS;
  return Math.min(60_000, Math.max(0, Math.round(value)));
}

function wordCount(text) {
  const trimmed = String(text ?? "").replace(/\s+/g, " ").trim();
  return trimmed ? trimmed.split(" ").length : 0;
}

/** Only patterns the answer actually contains are ever reported. */
const GRAMMAR_RULES = [
  { find: /\bpeople is\b/i, original: "people is", corrected: "people are", explanation: '"People" is plural, so it takes a plural verb.' },
  { find: /\bmore better\b/i, original: "more better", corrected: "better", explanation: '"Better" is already comparative.' },
  { find: /\bi am agree\b/i, original: "I am agree", corrected: "I agree", explanation: '"Agree" is a verb and does not take "am".' },
];
const VOCABULARY_RULES = [
  { find: /\bgood\b/i, original: "good", alternative: "beneficial", explanation: "A more precise word for a positive effect." },
  { find: /\bbad\b/i, original: "bad", alternative: "detrimental", explanation: "A more precise word for a negative effect." },
  { find: /\bbig\b/i, original: "big", alternative: "substantial", explanation: "A more formal word for scale." },
];

/** One assessment job for one skill, derived only from the saved answers. */
function buildAssessmentJob(attemptId, attempt, skill, base, delayMs, now) {
  const section = mockExam.sections.find((s) => s.skill === skill);
  if (!section) return null;
  const program = ASSESSMENT_PROGRAMS[mockExam.type] ?? "IELTS_ACADEMIC";
  const spoken = skill === "speaking";
  const rows = section.groups.flatMap((group) =>
    group.questions.map((question) => {
      const saved = attempt.answers.get(question.id);
      const audio = saved === "[audio]";
      const original = audio || saved == null ? "" : String(saved);
      // A recorded take is represented by its transcript, exactly like the real
      // assessment pipeline (text comes from speech-to-text, audio stays intact).
      const transcript = audio ? `Synthetic transcript for ${question.prompt}` : null;
      const text = audio ? transcript : original;
      return { question, group, audio, original, text, transcript, submitted: audio || !!original.trim(), words: wordCount(text) };
    }),
  );
  const totalWords = rows.reduce((sum, row) => sum + row.words, 0);
  const answered = rows.filter((row) => row.submitted).length;
  // A deterministic estimate from the submission itself: the fixture never
  // invents work the student did not hand in.
  const band = totalWords === 0 ? 0 : totalWords >= 250 ? 7 : totalWords >= 150 ? 6 : 5;
  const holistic = Math.round((band / 9) * 75);
  const joined = rows.map((row) => row.text).join("\n");
  const argumentative = rows.some((row) => row.question.type === "essay_task2") && answered > 0;
  const forCovered = argumentative ? /(on the one hand|\bfor\b|support|proponent)/i.test(joined) : null;
  const againstCovered = argumentative ? /(however|on the other hand|against|critic|opponent)/i.test(joined) : null;
  const grammarCorrections = GRAMMAR_RULES.filter((rule) => rule.find.test(joined)).map((rule) => ({
    original: rule.original,
    corrected: rule.corrected,
    explanation: rule.explanation,
  }));
  const vocabularyUpgrades = VOCABULARY_RULES.filter((rule) => rule.find.test(joined)).map((rule) => ({
    original: rule.original,
    alternative: rule.alternative,
    explanation: rule.explanation,
  }));
  const parts = rows.map((row) => ({
    id: row.question.id,
    max: row.question.points,
    task: row.question.prompt,
    context: row.group.title ?? "",
  }));
  const submissions = rows.map((row) => ({
    questionId: row.question.id,
    partId: row.question.id,
    prompt: row.question.prompt,
    context: row.group.title ?? "",
    originalResponse: row.audio ? "" : row.original,
    wordCount: row.words,
    audioUrl: row.audio ? `${base}/mock/attempts/${attemptId}/speaking/${row.question.id}` : null,
    transcript: row.transcript
      ? {
          text: row.transcript,
          confidence: 0.9,
          segments: [{ start: 0, end: 12, text: row.transcript, confidence: 0.9 }],
          pronunciationEvidence: "UNAVAILABLE",
        }
      : null,
  }));
  const resultParts = rows.map((row) => ({
    id: row.question.id,
    rawScore: program === "MULTILEVEL" ? Math.round((band / 9) * row.question.points) : null,
    criteria:
      program === "MULTILEVEL"
        ? {}
        : { task_response: band, coherence_cohesion: band, lexical_resource: band, grammatical_range_accuracy: band },
    evidence: {
      task_response: row.submitted
        ? `${row.text.slice(0, 60)}${row.text.length > 60 ? "…" : ""}`
        : "No answer was submitted for this task.",
    },
    feedback: {
      taskCoverage: row.submitted ? `Answered with ${row.words} words in this task.` : "No answer was submitted for this task.",
      grammar: grammarCorrections.length
        ? "Some sentences need the corrections listed below."
        : "Sentences are grammatically clear; keep checking verb forms.",
      vocabulary: vocabularyUpgrades.length
        ? "Word choice is clear but general in places; see the alternatives below."
        : "Word choice fits the task.",
      fluencyCohesion: spoken
        ? "Ideas are linked with simple connectors; add signposting between turns."
        : "Paragraphs follow a clear progression; the conclusion restates the position.",
      ideaDevelopment: "Each body paragraph carries one main idea plus an example.",
      register: spoken ? "Spoken register is appropriate for the interview." : "Register is appropriately formal.",
      spellingPunctuation: "Punctuation is mostly accurate; check commas in long clauses.",
      strengths: row.submitted ? ["The task is answered directly."] : [],
      issues: row.submitted ? ["Develop this idea with a concrete example."] : ["Answer this task before submitting."],
      missedPrompts: row.submitted ? [] : [`Question ${row.question.number} was left unanswered.`],
      usefulPhrases: spoken ? ["That's an interesting question…", "To sum up…"] : ["On the one hand…", "A further consideration is…"],
      forCovered,
      againstCovered,
      position:
        forCovered === null
          ? "Not applicable to this task."
          : forCovered
            ? "The supporting side is covered."
            : "The supporting side is missing.",
      argumentBalance:
        againstCovered === null
          ? "Not applicable to this task."
          : againstCovered
            ? "Both sides are represented; keep the balance even."
            : "The opposing side is not developed; add a counter-argument paragraph.",
    },
  }));
  return {
    id: rid("assess"),
    skill,
    program,
    policyMode: (attempt.flow ?? "single_skill") === "full_test" ? "FULL_MOCK_AI_WITH_REVIEW" : "PRACTICE_AUTO_AI",
    createdAt: now,
    delayMs,
    aiScore: program === "MULTILEVEL" ? holistic : band,
    confidence: 0.8,
    rubricVersion:
      program === "MULTILEVEL"
        ? `${spoken ? "MULTILEVEL_SPEAKING" : "MULTILEVEL_WRITING"}_RUBRIC_V1`
        : `${spoken ? "IELTS_SPEAKING" : "IELTS_WRITING"}_RUBRIC_V1`,
    promptVersion: "PROMPT_V1",
    parts,
    submissions,
    result: {
      parts: resultParts,
      overallStrengths: [answered === rows.length ? "Every task in the section was answered." : `Answered ${answered} of ${rows.length} task(s).`],
      priorityImprovements: ["Develop each idea with a concrete example.", "Widen vocabulary to avoid repetition."],
      grammarCorrections,
      vocabularyUpgrades,
      improvedExamples: rows.map((row) => ({
        partId: row.question.id,
        text: `Model opening for "${row.question.prompt}": state the topic in one sentence, then add a reason and one example.`,
      })),
      recommendedPractice: spoken
        ? ["Record one Speaking Part 2 answer and re-listen for fluency.", "Practise signposting: firstly, however, in the end."]
        : ["Write one timed 250-word Task 2 essay.", "Rewrite the weaker task using the corrections below."],
      confidence: 0.8,
      pronunciationEvidence: "UNAVAILABLE",
    },
  };
}

/** Jobs enqueued by a submit, one per Writing/Speaking skill in the scope. */
function createAssessmentJobs(attemptId, attempt, skills, base, delayRaw) {
  const delayMs = assessmentDelayMs(delayRaw);
  const now = Date.now();
  return skills
    .filter((skill) => ASSESSMENT_SKILLS.includes(skill))
    .map((skill) => buildAssessmentJob(attemptId, attempt, skill, base, delayMs, now))
    .filter(Boolean);
}

/** Status from elapsed time only, so no timer is left behind by a request. */
function assessmentStatus(job, now) {
  const elapsed = now - job.createdAt;
  if (elapsed < job.delayMs / 2) return "PENDING";
  if (elapsed < job.delayMs) return "PROCESSING";
  return "SUCCEEDED";
}

/**
 * The student-visible projection. Scores, confidence and rubric output appear
 * only once the job has SUCCEEDED — a queued job never carries a fabricated
 * grade. `finalScore` stays null: the teacher remains the final authority.
 */
function assessmentView(job, now) {
  const status = assessmentStatus(job, now);
  const done = status === "SUCCEEDED";
  return {
    id: job.id,
    skill: job.skill,
    program: job.program,
    status,
    policyMode: job.policyMode,
    version: 1,
    aiScore: done ? job.aiScore : null,
    teacherScore: null,
    finalScore: null,
    finalScoreSource: null,
    confidence: done ? job.confidence : null,
    rubricVersion: job.rubricVersion,
    promptVersion: job.promptVersion,
    evaluation: done ? { result: job.result } : null,
    approvedFeedback: null,
    submissions: job.submissions,
    parts: job.parts,
  };
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

const server = http.createServer(async (req, res) => {
  const u = new URL(req.url ?? "/", "http://x");
  const path = u.pathname;
  const method = req.method ?? "GET";
  // Dev-only CORS so the app can be exercised from a browser origin
  // (VITE_API_URL=http://127.0.0.1:3101/v1 npm run dev). Loopback, in-memory,
  // no credentials beyond the mock bearer token.
  res.setHeader("Access-Control-Allow-Origin", req.headers.origin ?? "*");
  res.setHeader("Access-Control-Allow-Headers", "Authorization, Content-Type, Range");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS");
  res.setHeader("Access-Control-Expose-Headers", "Content-Range, Accept-Ranges, Content-Length");
  res.setHeader("Vary", "Origin");
  if (method === "OPTIONS") {
    res.writeHead(204);
    return res.end();
  }
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

  // --- exam tracks (Dashboard/Exams gate their queries on this) ---
  if (method === "GET" && path === "/v1/exam-programs/mine") {
    return ok(res, { availablePrograms: ["IELTS", "MULTILEVEL"], activeProgram, accessPolicy: "SELF_SELECT" });
  }
  if (method === "PATCH" && path === "/v1/exam-programs/mine") {
    if (body.program === "IELTS" || body.program === "MULTILEVEL") activeProgram = body.program;
    return ok(res, { availablePrograms: ["IELTS", "MULTILEVEL"], activeProgram, accessPolicy: "SELF_SELECT" });
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
    const scope = requestedScope(body);
    for (const [id, a] of attempts) {
      if (a.kind === "mock" && a.studentId === userId && a.status === "in_progress") {
        if ((a.scope ?? null) !== scope) {
          // A different practice scope needs its own attempt; the real backend
          // force-submits the stale one and starts fresh.
          a.status = "completed";
          continue;
        }
        return ok(res, startPayload(id, a, body.mode ?? a.mode));
      }
    }
    const id = rid("matt");
    const a = { kind: "mock", examId: "mock-1", studentId: userId, scope, mode: body.mode ?? "practice", status: "in_progress", answers: new Map(), startedAt: new Date().toISOString() };
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
    // A scoped attempt owns exactly one section, so an empty submit grades only
    // that section (the real backend does the same for partial attempts).
    const skills = Array.isArray(body.skills) && body.skills.length
      ? body.skills
      : (a.scope ? [a.scope] : SKILLS);
    const rawScores = {};
    for (const s of skills) rawScores[s] = { score: a.answers.size, max: 10 };
    // Same side effect as the real backend: submitting enqueues the AI feedback
    // for the Writing/Speaking skills it graded. Listening/Reading need none.
    assessmentJobs.set(m[1], createAssessmentJobs(m[1], a, skills, base, body.assessmentDelayMs));
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

  // --- AI assessment (Writing/Speaking feedback; see src/lib/assessment.ts) ---
  m = path.match(/^\/v1\/assessment\/attempts\/([^/]+)$/);
  if (method === "GET" && m) {
    let attemptId = m[1];
    try {
      attemptId = decodeURIComponent(m[1]);
    } catch {
      /* keep the raw path segment */
    }
    if (!attempts.has(attemptId)) return fail(res, 404, "ATTEMPT_NOT_FOUND", "No such attempt");
    const now = Date.now();
    return ok(res, { attemptId, assessments: (assessmentJobs.get(attemptId) ?? []).map((job) => assessmentView(job, now)) });
  }

  if (method === "POST" && path === "/v1/exam-desktop/heartbeat") return ok(res, { received: true });
  return fail(res, 404, "NOT_FOUND", `No mock route ${method} ${path}`);

  function startPayload(id, a, mode) {
    const saved = {};
    for (const [k, v] of a.answers) saved[k] = v;
    const scope = a.scope ?? null;
    const fullTest = (a.flow ?? "single_skill") === "full_test";
    const payload = {
      attemptId: id,
      resumed: a.answers.size > 0,
      mode,
      startedAt: a.startedAt,
      deadlineAt: null,
      serverTime: new Date().toISOString(),
      durationMinutes: null,
      flowMode: fullTest ? "full_test" : "single_skill",
      currentSkill: fullTest ? a.currentSkill ?? SKILLS[0] : scope,
      sectionDeadlines: null,
      overallDeadlineAt: null,
      exam: shapeExamForStudent(base, scope),
      annotations: [],
      savedAnswers: saved,
    };
    if (scope) {
      payload.isSingleSection = true;
      payload.singleSection = scope;
      payload.attemptTypeLabel = `Single Section: ${scope[0].toUpperCase()}${scope.slice(1)}`;
      payload.practiceScope = { skills: [scope], single_section: scope, section_filter: scope };
    }
    return payload;
  }
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`mock-server listening on http://127.0.0.1:${PORT}/v1`);
});
