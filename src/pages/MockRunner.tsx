import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import AnswerWidgets from "@/components/exam/AnswerWidgets";
import BlobImage from "@/components/exam/BlobImage";
import GappedContent, { gapNumbersIn, hasGappedDocument } from "@/components/exam/GappedContent";
import ListeningPane from "@/components/exam/ListeningPane";
import SpeakingPane from "@/components/exam/SpeakingPane";
import {
  MOCK_SKILL_LABEL,
  bulkMockAnswers,
  mockGroupAudioUrl,
  resolveMockMediaUrl,
  saveMockAnswer,
  submitMockAttempt,
  uploadMockSpeaking,
  type MockShapedQuestion,
  type MockShapedSection,
  type MockSkill,
  type MockStartResult,
  type MockSubmitResult,
} from "@/lib/mocks";
import type { QuestionType, RunnerQuestion, TestSection } from "@/lib/tests";

type Props = {
  start: MockStartResult;
  section: MockShapedSection;
  onExit: () => void;
  onBackToSections: () => void;
  onFinish: (result: MockSubmitResult) => void;
};

function fmtClock(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return `${h > 0 ? `${h}:` : ""}${String(m).padStart(h > 0 ? 2 : 1, "0")}:${String(s).padStart(2, "0")}`;
}

/** Map the 15 mock question types onto the shared answer widgets. */
function toWidgetQuestion(
  mq: MockShapedQuestion,
  skill: MockSkill,
  groupInstructions: string | null,
): RunnerQuestion {
  let type: QuestionType = "short_answer";
  let kind: string | null = null;
  switch (mq.type) {
    case "multiple_choice":
    case "true_false_notgiven":
    case "yes_no_notgiven":
      type = "multiple_choice";
      break;
    case "matching":
    case "matching_headings":
      kind = "matching";
      type = "multiple_choice";
      break;
    case "map_labelling":
      kind = "map_label";
      type = "multiple_choice";
      break;
    case "essay_task1":
    case "essay_task2":
      type = "essay";
      break;
    case "speaking_task":
      type = "speaking_prompt";
      break;
    default:
      type = "short_answer";
      break;
  }
  return {
    id: mq.id,
    section: skill as TestSection,
    type,
    prompt: mq.prompt,
    options: mq.options,
    maxScore: mq.points,
    wordLimit: mq.wordLimit,
    instructions: groupInstructions,
    kind,
  };
}

function friendlyError(e: unknown): string {
  if (typeof e === "object" && e !== null) {
    const { code, message } = e as { code?: unknown; message?: unknown };
    if (typeof message === "string" && message) {
      return typeof code === "string" && code ? `${message} (${code})` : message;
    }
  }
  if (e instanceof Error && e.message) return e.message;
  return "Request failed. Check connection.";
}

/**
 * Section runner: exactly ONE group (part) per page, Next to continue.
 * Timed deadlines come from the server (sectionDeadlines); speaking has none.
 * Submit grades ONLY this section (`skills` filter) — other sections can be
 * taken separately from the section picker.
 */
export default function MockRunner({ start, section, onExit, onBackToSections, onFinish }: Props) {
  const attemptId = start.attemptId;
  const skill = section.skill;
  const timed = start.mode === "timed";
  const groups = useMemo(
    () => [...section.groups].sort((a, b) => a.sortOrder - b.sortOrder),
    [section],
  );

  const [groupIdx, setGroupIdx] = useState(0);
  const [answers, setAnswers] = useState<Record<string, string>>(() => {
    const out: Record<string, string> = {};
    for (const [qid, v] of Object.entries(start.savedAnswers ?? {})) {
      if (v !== "[audio]") out[qid] = v;
    }
    return out;
  });
  const [audioDone, setAudioDone] = useState<Record<string, boolean>>(() => {
    const out: Record<string, boolean> = {};
    for (const [qid, v] of Object.entries(start.savedAnswers ?? {})) {
      if (v === "[audio]") out[qid] = true;
    }
    return out;
  });
  const [uploadNotes, setUploadNotes] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const submittingRef = useRef(false);

  const dirty = useRef<Set<string>>(new Set());
  const answersRef = useRef(answers);
  useEffect(() => {
    answersRef.current = answers;
  }, [answers]);

  // Server deadline for THIS section (speaking => null => no timer).
  const deadlineTs = useMemo(() => {
    const iso = start.sectionDeadlines?.[skill] ?? start.overallDeadlineAt ?? start.deadlineAt;
    return iso ? new Date(iso).getTime() : null;
  }, [start, skill]);
  const [remaining, setRemaining] = useState<number | null>(
    () => (deadlineTs ? deadlineTs - Date.now() : null),
  );

  const flush = useCallback(async () => {
    const ids = [...dirty.current];
    if (ids.length === 0) return;
    dirty.current.clear();
    const payload = ids.map((id) => ({ questionId: id, response: answersRef.current[id] ?? "" }));
    if (payload.length === 1) {
      await saveMockAnswer(attemptId, payload[0].questionId, payload[0].response);
    } else {
      await bulkMockAnswers(attemptId, payload);
    }
  }, [attemptId]);

  const doSubmit = useCallback(
    async (auto: boolean) => {
      if (submittingRef.current) return;
      if (!auto && !confirm(`Submit ${MOCK_SKILL_LABEL[skill]}? You won't be able to change answers afterwards.`))
        return;
      submittingRef.current = true;
      setSubmitting(true);
      setError(null);
      try {
        try {
          await flush();
        } catch (e) {
          // Time-up blocks saves but submit itself is still allowed.
          setError(friendlyError(e));
        }
        const result = await submitMockAttempt(attemptId, [skill]);
        onFinish(result);
      } catch (e) {
        submittingRef.current = false;
        setSubmitting(false);
        setError(friendlyError(e));
      }
    },
    [attemptId, skill, flush, onFinish],
  );

  useEffect(() => {
    if (deadlineTs == null) return;
    setRemaining(deadlineTs - Date.now());
    const id = window.setInterval(() => {
      const r = deadlineTs - Date.now();
      setRemaining(r);
      if (r <= 0) {
        window.clearInterval(id);
        void doSubmit(true);
      }
    }, 1000);
    return () => window.clearInterval(id);
  }, [deadlineTs, doSubmit]);

  function setAnswer(qid: string, val: string, immediate = false) {
    setAnswers((a) => ({ ...a, [qid]: val }));
    if (immediate) {
      void saveMockAnswer(attemptId, qid, val).catch((e) => setError(friendlyError(e)));
    } else {
      dirty.current.add(qid);
    }
  }

  async function handleBlob(qid: string, blob: Blob) {
    setUploadNotes((n) => ({ ...n, [qid]: "Uploading…" }));
    try {
      await uploadMockSpeaking(attemptId, qid, blob);
      setAudioDone((s) => ({ ...s, [qid]: true }));
      setUploadNotes((n) => ({ ...n, [qid]: "Uploaded ✓ — your teacher will grade it." }));
    } catch (e) {
      setUploadNotes((n) => ({
        ...n,
        [qid]: `Upload failed (${friendlyError(e)}). Re-record to retry — notes below are still saved.`,
      }));
    }
  }

  async function goNext() {
    setError(null);
    try {
      await flush();
    } catch (e) {
      setError(friendlyError(e));
      return;
    }
    setGroupIdx((i) => Math.min(i + 1, groups.length - 1));
    window.scrollTo({ top: 0 });
  }

  function goPrev() {
    setGroupIdx((i) => Math.max(i - 1, 0));
    window.scrollTo({ top: 0 });
  }

  const group = groups[groupIdx];
  const groupQuestions = group?.questions ?? [];
  const allIds = section.groups.flatMap((g) => g.questions.map((q) => q.id));
  const answered = allIds.filter((id) => (answers[id] ?? "").trim() !== "" || audioDone[id]).length;
  const total = allIds.length;
  const isLast = groupIdx >= groups.length - 1;
  const audioSrc = group ? mockGroupAudioUrl(group, attemptId, timed && skill === "listening") : null;
  const imageSrc = group ? resolveMockMediaUrl(group.imageUrl) : null;
  // Gapped rich document (notes/table/summary completion): questions live
  // INSIDE the document as inline gap inputs, mapped by question number.
  const hasGapped = hasGappedDocument(group?.contentHtml);
  const gappedNumbers = useMemo(
    () => (hasGapped && group ? gapNumbersIn(group.contentHtml!) : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- group identity is stable per page; contentHtml read once per group
    [hasGapped, groupIdx],
  );
  const gappedSet = useMemo(() => new Set(gappedNumbers), [gappedNumbers]);
  const leftoverQuestions = (group?.questions ?? []).filter((q) => !gappedSet.has(q.number));

  if (!group) {
    return (
      <section className="mx-auto w-full max-w-3xl">
        <p className="text-sm text-white/60">This section has no parts yet.</p>
        <button type="button" onClick={onBackToSections} className="btn-ghost mt-3 rounded-xl px-4 py-2 text-sm font-bold text-white">
          ← Sections
        </button>
      </section>
    );
  }

  return (
    <section className="mx-auto flex w-full max-w-5xl flex-1 flex-col">
      {/* Header */}
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={onBackToSections}
          className="rounded-lg px-2 py-1 text-xs font-semibold text-white/50 ring-1 ring-white/10 hover:text-white"
        >
          ← Sections
        </button>
        <div className="min-w-0">
          <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-brand/70">
            {MOCK_SKILL_LABEL[skill]} · Part {groupIdx + 1} of {groups.length}
          </p>
          <h1 className="truncate text-lg font-black text-white">
            {group.title || `${MOCK_SKILL_LABEL[skill]} Part ${group.partNumber ?? groupIdx + 1}`}
          </h1>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <span className="rounded-full bg-white/5 px-3 py-1.5 text-xs font-semibold text-white/60 ring-1 ring-white/10 tabular-nums">
            {answered} / {total} answered
          </span>
          {remaining != null && (
            <span
              className={`rounded-full px-3 py-1.5 font-mono text-sm font-black tabular-nums ring-1 ${
                remaining < 5 * 60_000
                  ? "bg-red-500/15 text-red-200 ring-red-500/40"
                  : "bg-white/5 text-white ring-white/10"
              }`}
              aria-label="Time left"
            >
              ⏱ {fmtClock(remaining)}
            </span>
          )}
          <button
            type="button"
            onClick={onExit}
            className="rounded-lg px-2 py-1 text-xs font-semibold text-white/50 ring-1 ring-white/10 hover:text-white"
          >
            Exit
          </button>
        </div>
      </div>
      {timed && skill === "speaking" && (
        <p className="mt-2 text-[11px] text-white/35">No time limit for Speaking — submit when you finish.</p>
      )}

      {/* Material */}
      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <div className="min-w-0">
          {skill === "listening" && audioSrc && (
            <ListeningPane
              src={audioSrc}
              title={group.title || `Part ${group.partNumber ?? groupIdx + 1}`}
              instructions={group.instructions}
              strict={timed}
            />
          )}
          {skill === "listening" && !audioSrc && (
            <p className="rounded-2xl bg-black/40 p-4 text-sm text-amber-200/80 ring-1 ring-white/10">
              No audio attached to this part yet — answer from the instructions below.
            </p>
          )}
          {group.passageText && (
            <div className="max-h-[60vh] overflow-y-auto whitespace-pre-wrap rounded-2xl bg-black/40 p-4 text-sm leading-relaxed text-white/85 ring-1 ring-white/10">
              {group.passageText}
            </div>
          )}
          {imageSrc && (
            <BlobImage
              src={imageSrc}
              alt=""
              className="mt-3 max-h-96 w-full rounded-2xl border border-white/10 object-contain"
            />
          )}
          {group.instructions && skill !== "listening" && !hasGapped && (
            <div className="mt-3 rounded-xl bg-[#89F336]/[0.06] px-3.5 py-2.5 text-xs leading-relaxed text-fg-muted ring-1 ring-[#89F336]/20">
              <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-[#89F336]/80">Instructions</p>
              <p className="mt-1 whitespace-pre-wrap">{group.instructions}</p>
            </div>
          )}
        </div>

        {/* Questions — one group per page */}
        <div className="min-w-0 space-y-4">
          {hasGapped && (
            <div className="rounded-2xl bg-black/30 p-4 ring-1 ring-white/10">
              {group.instructions && (
                <div className="mb-3">
                  <p className="text-sm font-semibold text-white">
                    Questions {groupQuestions[0]?.number ?? ""}–{groupQuestions[groupQuestions.length - 1]?.number ?? ""}
                  </p>
                  <p className="mt-1 whitespace-pre-wrap text-sm leading-relaxed text-white/70">{group.instructions}</p>
                </div>
              )}
              <GappedContent
                contentHtml={group.contentHtml!}
                questions={groupQuestions}
                renderGap={({ number, question }) =>
                  question ? (
                    <span className="mx-1 inline-flex max-w-full items-center gap-1.5 align-middle">
                      <span className="grid size-6 shrink-0 place-items-center rounded-full bg-brand-subtle text-xs font-bold text-brand-subtle-fg tabular-nums">
                        {number}
                      </span>
                      <input
                        value={answers[question.id] ?? ""}
                        onChange={(e) => setAnswer(question.id, e.target.value)}
                        aria-label={`Answer for question ${number}`}
                        autoComplete="off"
                        spellCheck={false}
                        className="field inline-flex h-8 min-w-24 w-32 rounded-lg px-2 text-sm sm:w-40"
                      />
                    </span>
                  ) : (
                    <span className="mx-1 inline-flex rounded bg-red-500/15 px-2 py-1 text-xs text-red-300" role="alert">
                      Q{number}
                    </span>
                  )
                }
              />
            </div>
          )}
          {(hasGapped ? leftoverQuestions : groupQuestions).map((mq) => {
            const wq = toWidgetQuestion(mq, skill, group.instructions);
            return (
              <div key={mq.id} className="rounded-2xl bg-black/30 p-4 ring-1 ring-white/10">
                <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-white/35">
                  Q{mq.number} · {mq.points} pt{mq.points === 1 ? "" : "s"}
                </p>
                <p className="mt-1 whitespace-pre-wrap text-sm leading-relaxed text-white/90">{mq.prompt}</p>
                {mq.type === "speaking_task" ? (
                  <div className="mt-3">
                    <SpeakingPane
                      q={wq}
                      num={mq.number}
                      fontSize={15}
                      onBlob={(blob) => void handleBlob(mq.id, blob)}
                      uploadNote={uploadNotes[mq.id] ?? null}
                    />
                    <textarea
                      value={answers[mq.id] ?? ""}
                      onChange={(e) => setAnswer(mq.id, e.target.value)}
                      placeholder="Draft your notes here (optional)…"
                      rows={3}
                      className="field mt-3 min-h-20 w-full rounded-xl px-3 py-2.5 text-sm leading-relaxed"
                    />
                  </div>
                ) : mq.type === "multi_select" ? (
                  <MultiSelect
                    options={mq.options ?? []}
                    value={answers[mq.id] ?? ""}
                    onChange={(v) => setAnswer(mq.id, v, true)}
                  />
                ) : (
                  <AnswerWidgets q={wq} value={answers[mq.id] ?? ""} onChange={(v) => setAnswer(mq.id, v, mq.type === "multiple_choice" || mq.type === "true_false_notgiven" || mq.type === "yes_no_notgiven")} fontSize={15} />
                )}
              </div>
            );
          })}
        </div>
      </div>

      {error && (
        <p role="alert" className="mt-3 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300">
          {error}
        </p>
      )}

      {/* Footer: Prev / Next — one part per page */}
      <div className="mt-5 flex items-center gap-2 pb-6">
        <button
          type="button"
          onClick={goPrev}
          disabled={groupIdx === 0}
          className="btn-ghost rounded-xl px-4 py-2.5 text-sm font-bold text-white disabled:opacity-40"
        >
          ← Prev
        </button>
        <span className="mx-auto text-[11px] text-white/35 tabular-nums">
          Part {groupIdx + 1} / {groups.length}
        </span>
        {!isLast ? (
          <button
            type="button"
            onClick={() => void goNext()}
            className="btn-brand rounded-xl px-6 py-2.5 text-sm font-bold"
          >
            Next →
          </button>
        ) : (
          <button
            type="button"
            onClick={() => void doSubmit(false)}
            disabled={submitting}
            className="btn-brand rounded-xl px-6 py-2.5 text-sm font-bold disabled:opacity-50"
          >
            {submitting ? "Submitting…" : `Submit ${MOCK_SKILL_LABEL[skill]}`}
          </button>
        )}
      </div>
    </section>
  );
}

/** Checkbox group for multi_select (backend scores the exact set). */
function MultiSelect({ options, value, onChange }: { options: string[]; value: string; onChange: (v: string) => void }) {
  const selected = value ? value.split(",").map((v) => v.trim()).filter(Boolean) : [];
  function toggle(opt: string) {
    const next = selected.includes(opt) ? selected.filter((v) => v !== opt) : [...selected, opt];
    next.sort((a, b) => options.indexOf(a) - options.indexOf(b));
    onChange(next.join(","));
  }
  return (
    <ul className="mt-3 space-y-1.5">
      {options.map((o, oi) => {
        const active = selected.includes(o);
        return (
          <li key={oi}>
            <button
              type="button"
              onClick={() => toggle(o)}
              aria-pressed={active}
              className={`flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-[13px] ring-1 transition ${
                active ? "bg-[#89F336]/12 text-white ring-[#89F336]/50" : "bg-black/30 text-white/70 ring-white/10 hover:ring-white/25"
              }`}
            >
              <span
                className={`grid size-5 shrink-0 place-items-center rounded-md border text-[11px] font-bold ${
                  active ? "border-[#89F336] bg-[#89F336] text-black" : "border-white/25 text-white/50"
                }`}
              >
                {active ? "✓" : ""}
              </span>
              <span>{o}</span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}
