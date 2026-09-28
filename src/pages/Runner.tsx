import { useEffect, useMemo, useRef, useState } from "react";
import { getConfirmBeforeSubmit } from "@/lib/exam-prefs";
import { resolveAudioUrl, saveAnswer, saveMarks, submitAttempt } from "@/lib/tests";
import type { RunnerQuestion, StartResult, TestListItem } from "@/lib/tests";
import {
  getExamFontSize,
  helpTextFor,
  kindLabel,
  loadFlags,
  loadPartMarks,
  materialOwnerId,
  mergeMarks,
  normalizeKind,
  saveFlags,
  savePartMarks,
  setExamFontSize,
  type PartMarks,
} from "@/lib/exam-types";
import ExamHeader from "@/components/exam/ExamHeader";
import QuestionPalette from "@/components/exam/QuestionPalette";
import AnswerWidgets from "@/components/exam/AnswerWidgets";
import ListeningPane from "@/components/exam/ListeningPane";
import ReadingPane from "@/components/exam/ReadingPane";
import WritingPane from "@/components/exam/WritingPane";
import SpeakingPane from "@/components/exam/SpeakingPane";
import ReviewModal from "@/components/exam/ReviewModal";

type Props = {
  test: TestListItem;
  start: StartResult;
  onLocked: () => void;
  onExit: () => void;
  onFinish: (score: { autoScore: number | null }) => void;
};

interface PartItem {
  q: RunnerQuestion;
  num: number;
}

interface Part {
  key: string;
  section: string;
  audioUrl: string | null;
  instructions: string | null;
  passageText: string | null;
  items: PartItem[];
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

/** Group consecutive questions sharing section + audio into exam parts. */
function buildParts(questions: RunnerQuestion[]): Part[] {
  const parts: Part[] = [];
  questions.forEach((q, i) => {
    const audioKey = q.audioUrl ?? (q.hasAudio ? `flag:${q.id}` : "none");
    const key = `${q.section}::${audioKey}`;
    const last = parts[parts.length - 1];
    if (last && last.key === key) {
      last.items.push({ q, num: i + 1 });
      if (!last.instructions && q.instructions) last.instructions = q.instructions;
      if (!last.passageText && q.passageText) last.passageText = q.passageText;
    } else {
      parts.push({
        key,
        section: q.section,
        audioUrl: resolveAudioUrl(q.audioUrl),
        instructions: q.instructions ?? null,
        passageText: q.passageText ?? null,
        items: [{ q, num: i + 1 }],
      });
    }
  });
  return parts;
}

function capitalize(s: string): string {
  return s.length === 0 ? s : s.charAt(0).toUpperCase() + s.slice(1);
}

function isListening(section: string): boolean {
  return section.toLowerCase().includes("listen");
}

function isWriting(section: string): boolean {
  return section.toLowerCase().includes("writ");
}

function isSpeaking(section: string): boolean {
  return section.toLowerCase().includes("speak");
}

export default function Runner({ test, start, onLocked, onExit, onFinish }: Props) {
  const [answers, setAnswers] = useState<Record<string, string>>(
    () => start.savedAnswers ?? {},
  );
  const [flags, setFlags] = useState<Record<string, boolean>>(() => loadFlags(start.attemptId));
  const [fontSize, setFontSize] = useState(() => getExamFontSize());
  const [savingId, setSavingId] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [reviewOpen, setReviewOpen] = useState(false);
  const [paletteCollapsed, setPaletteCollapsed] = useState(false);
  const [leftWidth, setLeftWidth] = useState(50);

  const parts = useMemo(() => buildParts(start.questions), [start.questions]);
  const [partIdx, setPartIdx] = useState(0);
  const [currentNum, setCurrentNum] = useState(1);

  // Reading marks (highlights + notes) per part index. Local-first: seeded
  // from localStorage, merged with server savedMarks, synced back debounced.
  const [marks, setMarks] = useState<Record<number, PartMarks>>(() => {
    const init: Record<number, PartMarks> = {};
    const count = buildParts(start.questions).length;
    for (let i = 0; i < count; i++) init[i] = loadPartMarks(start.attemptId, i);
    return init;
  });
  const marksTimers = useRef(new Map<number, number>());

  // Merge server-saved marks once (resume on another device, etc.).
  useEffect(() => {
    const saved = start.savedMarks;
    if (!saved) return;
    const ownerIdx = new Map<string, number>();
    parts.forEach((p, i) => {
      const owner = materialOwnerId(p.items);
      if (owner) ownerIdx.set(owner, i);
    });
    setMarks((prev) => {
      const next = { ...prev };
      let changed = false;
      for (const [qid, m] of Object.entries(saved)) {
        const idx = ownerIdx.get(qid);
        if (idx == null) continue;
        const merged = mergeMarks(next[idx] ?? { highlights: [], note: "" }, m);
        if (JSON.stringify(merged) !== JSON.stringify(next[idx])) {
          next[idx] = merged;
          savePartMarks(start.attemptId, idx, merged);
          changed = true;
        }
      }
      return changed ? next : prev;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mount-once answer-cache hydration; setters are stable, re-running would wipe in-progress answers
  }, []);

  // Debounced server sync timers die with the runner.
  useEffect(
    () => () => {
      marksTimers.current.forEach((t) => window.clearTimeout(t));
      marksTimers.current.clear();
    },
    [],
  );

  function updateMarks(idx: number, next: PartMarks) {
    setMarks((prev) => ({ ...prev, [idx]: next }));
    savePartMarks(start.attemptId, idx, next);
    const owner = activePartOwner(idx);
    if (!owner) return;
    const prevTimer = marksTimers.current.get(idx);
    if (prevTimer) window.clearTimeout(prevTimer);
    marksTimers.current.set(
      idx,
      window.setTimeout(() => {
        marksTimers.current.delete(idx);
        // Silent on failure — local copy is the source of truth offline.
        saveMarks(start.attemptId, owner, { highlights: next.highlights, note: next.note }).catch(
          () => undefined,
        );
      }, 800),
    );
  }

  function activePartOwner(idx: number): string | null {
    const p = parts[idx];
    return p ? materialOwnerId(p.items) : null;
  }

  const rightScrollRef = useRef<HTMLDivElement | null>(null);
  const qRefs = useRef(new Map<number, HTMLElement>());
  const dividerRef = useRef<HTMLDivElement | null>(null);

  const total = start.questions.length;
  const answered = useMemo(
    () => start.questions.filter((q) => (answers[q.id] ?? "").trim().length > 0).length,
    [answers, start.questions],
  );
  const progress = total === 0 ? 0 : Math.round((answered / total) * 100);

  const deadline = useMemo(() => {
    if (test.durationMinutes == null || test.durationMinutes <= 0) return null;
    return new Date(start.startedAt).getTime() + test.durationMinutes * 60_000;
  }, [test.durationMinutes, start.startedAt]);

  useEffect(() => {
    if (deadline == null) return;
    const t = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, [deadline]);

  const remaining = deadline == null ? null : deadline - now;
  const timeUp = remaining != null && remaining <= 0;

  const activePart = parts[partIdx] ?? null;
  const partFirst = activePart?.items[0]?.num ?? 1;
  const partLast = activePart?.items[activePart.items.length - 1]?.num ?? total;
  const rangeLabel = total === 0 ? "0 questions" : `Q${partFirst}–Q${partLast}`;

  const flaggedNums = useMemo(
    () =>
      start.questions
        .map((q, i) => (flags[q.id] ? i + 1 : null))
        .filter((n): n is number => n != null),
    [flags, start.questions],
  );
  const unansweredNums = useMemo(
    () =>
      start.questions
        .map((q, i) => ((answers[q.id] ?? "").trim() ? null : i + 1))
        .filter((n): n is number => n != null),
    [answers, start.questions],
  );

  // Dominant widget kind in the active part → contextual Help text.
  const helpText = useMemo(() => {
    if (!activePart) return helpTextFor("short_answer");
    const counts = new Map<string, number>();
    for (const it of activePart.items) {
      const k = normalizeKind(it.q);
      counts.set(k, (counts.get(k) ?? 0) + 1);
    }
    let best = "short_answer";
    let bestN = -1;
    for (const [k, n] of counts) {
      if (n > bestN) {
        bestN = n;
        best = k;
      }
    }
    return helpTextFor(best as Parameters<typeof helpTextFor>[0]);
  }, [activePart]);

  function changeFont(px: number) {
    const clamped = Math.min(20, Math.max(12, px));
    setFontSize(clamped);
    setExamFontSize(clamped);
  }

  function toggleFlag(questionId: string) {
    setFlags((prev) => {
      const next = { ...prev, [questionId]: !prev[questionId] };
      if (!next[questionId]) delete next[questionId];
      saveFlags(start.attemptId, next);
      return next;
    });
  }

  function scrollToNum(num: number) {
    setCurrentNum(num);
    requestAnimationFrame(() => {
      qRefs.current.get(num)?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  }

  function jumpToNum(num: number) {
    const owner = parts.findIndex((p) => p.items.some((it) => it.num === num));
    if (owner !== -1 && owner !== partIdx) setPartIdx(owner);
    scrollToNum(num);
  }

  function gotoPart(idx: number, num?: number) {
    const clamped = Math.min(Math.max(0, idx), parts.length - 1);
    setPartIdx(clamped);
    const target = num ?? parts[clamped]?.items[0]?.num ?? 1;
    if (num == null) rightScrollRef.current?.scrollTo({ top: 0 });
    scrollToNum(target);
  }

  function stepQuestion(dir: -1 | 1) {
    const next = Math.min(total, Math.max(1, currentNum + dir));
    const owner = parts.findIndex((p) => p.items.some((it) => it.num === next));
    if (owner !== -1 && owner !== partIdx) setPartIdx(owner);
    scrollToNum(next);
  }

  async function handleAnswer(questionId: string, value: string) {
    setAnswers((prev) => ({ ...prev, [questionId]: value }));
    setSavingId(questionId);
    setError(null);
    try {
      await saveAnswer(start.attemptId, questionId, value);
    } catch (e) {
      setError(friendlyError(e));
    } finally {
      setSavingId((cur) => (cur === questionId ? null : cur));
    }
  }

  async function doSubmit() {
    setReviewOpen(false);
    setSubmitting(true);
    setError(null);
    try {
      const res = await submitAttempt(start.attemptId);
      onFinish({ autoScore: res?.autoScore ?? null });
    } catch (e) {
      setError(friendlyError(e));
      setSubmitting(false);
    }
  }

  function handleSubmitClick() {
    if (getConfirmBeforeSubmit()) {
      setReviewOpen(true);
      return;
    }
    void doSubmit();
  }

  // Draggable split divider (mouse + touch).
  useEffect(() => {
    const bar = dividerRef.current;
    if (!bar) return;
    let dragging = false;
    const onMove = (clientX: number) => {
      if (!dragging) return;
      const container = bar.parentElement;
      if (!container) return;
      const rect = container.getBoundingClientRect();
      if (rect.width <= 0) return;
      const pct = ((clientX - rect.left) / rect.width) * 100;
      setLeftWidth(Math.min(70, Math.max(30, Math.round(pct))));
    };
    const onMouseMove = (e: MouseEvent) => onMove(e.clientX);
    const onTouchMove = (e: TouchEvent) => {
      if (e.touches[0]) onMove(e.touches[0].clientX);
    };
    const stop = () => {
      dragging = false;
    };
    const onMouseDown = (e: MouseEvent) => {
      e.preventDefault();
      dragging = true;
    };
    const onTouchStart = (e: TouchEvent) => {
      e.preventDefault();
      dragging = true;
    };
    bar.addEventListener("mousedown", onMouseDown);
    bar.addEventListener("touchstart", onTouchStart, { passive: false });
    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", stop);
    window.addEventListener("touchmove", onTouchMove, { passive: true });
    window.addEventListener("touchend", stop);
    return () => {
      bar.removeEventListener("mousedown", onMouseDown);
      bar.removeEventListener("touchstart", onTouchStart);
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", stop);
      window.removeEventListener("touchmove", onTouchMove);
      window.removeEventListener("touchend", stop);
    };
  }, []);

  const showListening = activePart != null && (isListening(activePart.section) || activePart.audioUrl != null);
  const showReading = activePart != null && !showListening && activePart.passageText != null;
  const showWriting =
    activePart != null && !showListening && !showReading && isWriting(activePart.section);
  const showSpeaking =
    activePart != null && !showListening && !showReading && !showWriting && isSpeaking(activePart.section);
  const speakingItem =
    showSpeaking && activePart
      ? (activePart.items.find((it) => it.num === currentNum) ?? activePart.items[0] ?? null)
      : null;

  return (
    <section className="flex min-h-0 flex-1 flex-col">
      <ExamHeader
        testTitle={test.title}
        section={activePart?.section ?? "exam"}
        partIdx={partIdx}
        partsLength={parts.length}
        rangeLabel={rangeLabel}
        progress={progress}
        answered={answered}
        total={total}
        remainingMs={remaining}
        timeUp={timeUp}
        fontSize={fontSize}
        onFontChange={changeFont}
        helpText={helpText}
        onExit={onExit}
      />

      {timeUp && (
        <div className="shrink-0 border-b border-red-500/30 bg-red-500/10 px-5 py-2 text-center text-xs font-semibold text-red-200">
          Time is up — press Submit now. Your saved answers are safe.
        </div>
      )}

      {/* Two-panel workspace — resizable, full height */}
      <div
        className="grid min-h-0 flex-1"
        style={{ gridTemplateColumns: `${leftWidth}% 8px ${100 - leftWidth}%` }}
      >
        {/* LEFT — material: listening / reading / writing / speaking / fallback */}
        <aside className="flex min-h-0 min-w-0 flex-col border-r border-white/10 bg-[#0E1310]">
          <div className="shrink-0 border-b border-white/[0.07] px-5 pb-3 pt-4">
            <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-[#19D36B]/80">
              Part {partIdx + 1} of {parts.length}
            </p>
            <h2 className="mt-1 text-lg font-black tracking-tight text-white">
              {activePart ? `${capitalize(activePart.section)} · Questions ${partFirst}–${partLast}` : "Material"}
            </h2>
            <div className="mt-3 flex flex-wrap gap-1.5">
              {parts.map((p, i) => {
                const done = p.items.filter((it) => (answers[it.q.id] ?? "").trim()).length;
                const active = i === partIdx;
                return (
                  <button
                    key={p.key + i}
                    type="button"
                    onClick={() => gotoPart(i)}
                    aria-current={active ? "true" : undefined}
                    title={`${p.section} · Q${p.items[0]?.num}–Q${p.items[p.items.length - 1]?.num} · ${done}/${p.items.length} answered`}
                    className={`rounded-lg px-2.5 py-1.5 text-[11px] font-bold ring-1 transition ${
                      active
                        ? "bg-[#19D36B]/15 text-[#19D36B] ring-[#19D36B]/40"
                        : "bg-white/[0.04] text-white/50 ring-white/10 hover:text-white"
                    }`}
                  >
                    P{i + 1} · {done}/{p.items.length}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4" style={{ fontSize }}>
            {activePart == null ? (
              <p className="text-xs text-white/40">No material.</p>
            ) : showListening ? (
              activePart.audioUrl ? (
                <ListeningPane
                  src={activePart.audioUrl}
                  title={`${test.title} — Part ${partIdx + 1} audio`}
                  instructions={activePart.instructions}
                />
              ) : (
                <div className="rounded-2xl bg-black/30 p-4 text-xs text-[#8D9891] ring-1 ring-white/10">
                  No audio attached to this part. Answer from the material below.
                </div>
              )
            ) : showReading ? (
              <ReadingPane
                passage={activePart.passageText ?? ""}
                fontSize={fontSize}
                instructions={activePart.instructions}
                highlights={marks[partIdx]?.highlights ?? []}
                note={marks[partIdx]?.note ?? ""}
                onHighlightsChange={(h) =>
                  updateMarks(partIdx, { highlights: h, note: marks[partIdx]?.note ?? "" })
                }
                onNoteChange={(n) =>
                  updateMarks(partIdx, { highlights: marks[partIdx]?.highlights ?? [], note: n })
                }
              />
            ) : showWriting ? (
              <WritingPane
                items={activePart.items}
                answers={answers}
                currentNum={currentNum}
                fontSize={fontSize}
                instructions={activePart.instructions}
                onJump={jumpToNum}
              />
            ) : showSpeaking && speakingItem ? (
              <SpeakingPane q={speakingItem.q} num={speakingItem.num} fontSize={fontSize} />
            ) : (
              <>
                {activePart.instructions && (
                  <div className="rounded-xl bg-[#19D36B]/[0.06] px-3.5 py-2.5 text-xs leading-relaxed text-emerald-100/90 ring-1 ring-[#19D36B]/20">
                    <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-[#19D36B]/80">Instructions</p>
                    <p className="mt-1 whitespace-pre-wrap">{activePart.instructions}</p>
                  </div>
                )}
                {activePart.passageText ? (
                  <div className="mt-3 rounded-xl bg-black/30 px-3.5 py-2.5 ring-1 ring-white/10">
                    <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-white/35">Material</p>
                    <p className="mt-1 whitespace-pre-wrap text-xs leading-relaxed text-white/70">
                      {activePart.passageText}
                    </p>
                  </div>
                ) : (
                  <div className="mt-3 rounded-2xl bg-black/30 p-4 text-xs text-[#8D9891] ring-1 ring-white/10">
                    Answer the questions on the right.
                  </div>
                )}
              </>
            )}
          </div>
        </aside>

        {/* Draggable divider */}
        <div
          ref={dividerRef}
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize panels (drag)"
          title="Drag to resize · double-click to reset"
          onDoubleClick={() => setLeftWidth(50)}
          className="cursor-col-resize bg-white/[0.06] transition hover:bg-[#19D36B]/40"
        />

        {/* RIGHT — questions */}
        <div className="flex min-h-0 min-w-0 flex-col bg-[#0B0F0D]">
          <div className="shrink-0 border-b border-white/[0.07] px-5 pb-3 pt-4">
            <div className="flex items-baseline justify-between gap-3">
              <h2 className="text-sm font-bold text-white">
                Questions {partFirst}–{partLast}
              </h2>
              <p className="font-mono text-[11px] tabular-nums text-white/40">
                {activePart?.items.filter((it) => (answers[it.q.id] ?? "").trim()).length ?? 0}/
                {activePart?.items.length ?? 0} answered in this part
              </p>
            </div>
          </div>
          <div ref={rightScrollRef} className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
            <ol className="mx-auto w-full max-w-3xl space-y-3">
              {activePart?.items.map(({ q, num }) => {
                const done = (answers[q.id] ?? "").trim().length > 0;
                const flagged = Boolean(flags[q.id]);
                const kind = normalizeKind(q);
                return (
                  <li
                    key={q.id}
                    ref={(el) => {
                      if (el) qRefs.current.set(num, el);
                      else qRefs.current.delete(num);
                    }}
                    className={`scroll-mt-2 rounded-2xl bg-[#111713] p-4 ring-1 transition ${
                      currentNum === num ? "ring-[#19D36B]/45" : "ring-white/10"
                    }`}
                    onClick={() => setCurrentNum(num)}
                  >
                    <div className="flex items-center gap-2.5">
                      <span
                        className={`grid h-7 w-7 shrink-0 place-items-center text-xs font-black ${
                          flagged ? "rounded-full" : "rounded-lg"
                        } ${done ? "bg-[#19D36B] text-black" : "bg-white/10 text-white/55"}`}
                      >
                        {done ? "✓" : num}
                      </span>
                      <p className="min-w-0 flex-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-[#626B65]">
                        Q{num} · {q.section} · {kindLabel(kind)} · {q.maxScore} pt
                      </p>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          toggleFlag(q.id);
                        }}
                        aria-pressed={flagged}
                        title={flagged ? "Unflag (remove from review)" : "Flag for review"}
                        className={`shrink-0 rounded-lg px-2 py-1 text-xs ring-1 transition ${
                          flagged
                            ? "bg-amber-400/15 text-amber-200 ring-amber-400/50"
                            : "bg-white/[0.04] text-white/35 ring-white/10 hover:text-white"
                        }`}
                      >
                        {flagged ? "⚑ flagged" : "⚑ flag"}
                      </button>
                    </div>
                    <p className="mt-2.5 whitespace-pre-wrap leading-relaxed text-[#F2F5F3]" style={{ fontSize }}>
                      {q.prompt}
                    </p>
                    <AnswerWidgets
                      q={q}
                      value={answers[q.id] ?? ""}
                      onChange={(v) => void handleAnswer(q.id, v)}
                      fontSize={fontSize}
                    />
                    {savingId === q.id && (
                      <p className="mt-1.5 text-[11px] text-white/30">Saving…</p>
                    )}
                  </li>
                );
              })}
            </ol>
            {error && (
              <p role="alert" className="mx-auto mt-3 w-full max-w-3xl rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300">
                {error}
              </p>
            )}
          </div>
        </div>
      </div>

      {/* Bottom exam control strip */}
      <footer className="flex shrink-0 items-center gap-2 border-t border-white/10 bg-[#101512]/95 px-4 py-2">
        <button
          type="button"
          onClick={() => stepQuestion(-1)}
          disabled={currentNum <= 1}
          className="btn-ghost shrink-0 rounded-lg px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-40"
        >
          ← Prev
        </button>
        <button
          type="button"
          onClick={() => stepQuestion(1)}
          disabled={currentNum >= total}
          className="btn-ghost shrink-0 rounded-lg px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-40"
        >
          Next →
        </button>
        <span className="hidden shrink-0 font-mono text-[11px] tabular-nums text-white/45 md:inline">
          Q{currentNum}/{total}
        </span>
        <button
          type="button"
          onClick={() => setReviewOpen(true)}
          title="Review flagged and unanswered before submitting"
          className="btn-ghost hidden shrink-0 rounded-lg px-3 py-1.5 text-xs font-semibold text-white/70 hover:text-white sm:inline"
        >
          Review{flaggedNums.length > 0 ? ` (${flaggedNums.length} ⚑)` : ""}
        </button>
        <div className="min-w-0 flex-1" />
        <button
          type="button"
          onClick={onLocked}
          title="Simulate lock"
          className="hidden shrink-0 rounded-lg px-2.5 py-1.5 text-[11px] text-white/35 hover:text-white lg:inline"
        >
          Lock
        </button>
        <button
          type="button"
          onClick={handleSubmitClick}
          disabled={submitting || total === 0}
          className="shrink-0 rounded-lg bg-[#19D36B] px-5 py-1.5 text-xs font-black text-black shadow-[0_0_20px_rgba(25,211,107,0.3)] transition hover:brightness-110 disabled:opacity-50"
        >
          {submitting ? "Submitting…" : `Submit ${answered}/${total}`}
        </button>
      </footer>

      <QuestionPalette
        total={total}
        answers={answers}
        questionIds={start.questions.map((q) => q.id)}
        flags={flags}
        currentNum={currentNum}
        onJump={jumpToNum}
        collapsed={paletteCollapsed}
        onToggle={() => setPaletteCollapsed((v) => !v)}
      />

      <ReviewModal
        open={reviewOpen}
        answered={answered}
        total={total}
        flaggedNums={flaggedNums}
        unansweredNums={unansweredNums}
        submitting={submitting}
        onJump={jumpToNum}
        onClose={() => setReviewOpen(false)}
        onSubmit={() => void doSubmit()}
      />
    </section>
  );
}
