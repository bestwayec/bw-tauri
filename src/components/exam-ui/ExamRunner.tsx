import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getVolume, setVolume, VOLUME_EVENT } from "@/lib/volume";
import { isDefinitiveLogout, verdictOf } from "@/lib/session-store";
import BlobImage from "@/components/exam/BlobImage";
import GappedContent, { gapNumbersIn, hasGappedDocument } from "@/components/exam/GappedContent";
import BottomNav from "./BottomNav";
import ListeningEngine from "./ListeningEngine";
import { MultilevelListening, type MediaPhase } from '@/components/exam/multilevel-media';
import { post } from '@/lib/api';
import { flushBeforeSubmission } from '@/lib/exam-submission';
import { fetchAuthenticatedMedia } from '@/lib/media';
import PassagePane, { type PassageMarks } from "./PassagePane";
import QuestionGroup from "./QuestionGroup";
import TopBar, { type SaveState } from "./TopBar";
import { isAnswered, nextUnanswered, remainingMs, serverOffsetMs, type UIPart } from "./model";
import { answerRuleHint, exceedsAnswerConstraint, type AnswerRule } from '@/lib/objective-answers';

export interface ExamRunnerProps {
  attemptId: string;
  candidateName: string | null;
  sectionTitle: string;
  skill: string;
  timed: boolean;
  serverTime: string;
  /** Server ISO deadline for this section, or null when untimed. */
  deadlineIso: string | null;
  parts: UIPart[];
  initialAnswers: Record<string, string>;
  initialAudioDone?: Record<string, boolean>;
  storageKey: string;
  showVolume: boolean;
  submitLabel: string;
  saveOne: (qid: string, value: string) => Promise<void>;
  saveMany: (items: Array<{ questionId: string; response: string }>) => Promise<void>;
  /** Performs submit AND parent navigation. */
  submit: () => Promise<void>;
  onSpeakBlob?: (qid: string, blob: Blob) => void;
  speakNote?: (qid: string) => string | null;
  persistMarks?: (partKey: string, marks: PassageMarks) => void;
  onExit: () => void;
  /** Optional back navigation (mock section picker). */
  onBack?: () => void;
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

function errorCode(e: unknown): string | undefined {
  return verdictOf(e);
}

/** Persisted offline answer queue (survives reloads/crashes mid-exam). */
function queueKey(attemptId: string): string {
  return `examui.queue.${attemptId}`;
}

function loadQueue(attemptId: string): { answers: Record<string, string>; dirty: string[] } {
  try {
    const raw = localStorage.getItem(queueKey(attemptId));
    if (!raw) return { answers: {}, dirty: [] };
    const p = JSON.parse(raw) as { answers?: unknown; dirty?: unknown };
    return {
      answers:
        p.answers && typeof p.answers === "object"
          ? (p.answers as Record<string, string>)
          : {},
      dirty: Array.isArray(p.dirty) ? p.dirty.filter((x): x is string => typeof x === "string") : [],
    };
  } catch {
    return { answers: {}, dirty: [] };
  }
}

/**
 * Auth errors during an attempt must NEVER navigate away. Definitive session
 * verdicts surface a re-login modal over the exam (answers stay intact);
 * everything else is a banner + queued retry.
 */
export function notifyExamAuthIssue(e: unknown): boolean {
  if (!isDefinitiveLogout(errorCode(e))) return false;
  try {
    window.dispatchEvent(new CustomEvent("exam:reauth-required"));
  } catch {
    /* ignore */
  }
  return true;
}

/**
 * Unified IELTS exam runner (mock + legacy flows). Split-pane reading with
 * a draggable divider, question tabs + jump buttons, server-time deadlines,
 * offline-tolerant autosave, and a light-by-default theme.
 */
export default function ExamRunner(p: ExamRunnerProps) {
  const versioned = p.parts.some((part) => part.questions.some((q) => q.guidance));
  const writableIds = new Set(p.parts.flatMap((part) => part.questions.map((q) => q.id)));
  const [partIdx, setPartIdx] = useState(0);
  const [answers, setAnswers] = useState<Record<string, string>>(() => {
    // Merge the persisted offline queue: only ids that were still unsaved
    // (dirty) overlay the server snapshot — saved answers are authoritative.
    try {
      const q = loadQueue(p.attemptId);
      const dirtySet = new Set(q.dirty);
      const merged = { ...p.initialAnswers };
      for (const [qid, v] of Object.entries(q.answers)) {
        if (dirtySet.has(qid) && typeof v === "string" && (!versioned || writableIds.has(qid))) merged[qid] = v;
      }
      return merged;
    } catch {
      return p.initialAnswers;
    }
  });
  const [audioDone, setAudioDone] = useState<Record<string, boolean>>(() => p.initialAudioDone ?? {});
  useEffect(() => {
    const saved = (event: Event) => { const detail=(event as CustomEvent<{attemptId:string;questionId:string}>).detail; if(detail?.attemptId===p.attemptId) setAudioDone((previous)=>({...previous,[detail.questionId]:true})); };
    window.addEventListener('multilevel:recording-uploaded',saved); return()=>window.removeEventListener('multilevel:recording-uploaded',saved);
  },[p.attemptId]);
  const [flags, setFlags] = useState<Record<string, boolean>>(() => ({}));
  const [currentQ, setCurrentQ] = useState(0);
  const [fontSize, setFontSize] = useState(17);
  const [dark, setDark] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [noteOpen, setNoteOpen] = useState(false);
  const [volume, setVolumeState] = useState(() => getVolume());
  const [saveState, setSaveState] = useState<SaveState>("saved");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [timeUp, setTimeUp] = useState(false);
  const [leftWidth, setLeftWidth] = useState(50);

  const dirty = useRef<Set<string>>(
    new Set(
      (() => {
        try {
          return loadQueue(p.attemptId).dirty.filter((id) => !versioned || writableIds.has(id));
        } catch {
          return [];
        }
      })(),
    ),
  );
  const answersRef = useRef(answers);
  useEffect(() => {
    answersRef.current = answers;
  }, [answers]);
  const persistTimer = useRef<number | null>(null);

  // Multilevel writes synchronously so a section remount or immediate reload
  // cannot cancel the last keystroke's persistence timer.
  function persistQueue() {
    if (persistTimer.current) window.clearTimeout(persistTimer.current);
    const write = () => {
      try {
        if (dirty.current.size === 0) localStorage.removeItem(queueKey(p.attemptId));
        else {
          const snap: Record<string, string> = {};
          for (const id of dirty.current) snap[id] = answersRef.current[id] ?? "";
          localStorage.setItem(queueKey(p.attemptId), JSON.stringify({ answers: snap, dirty: [...dirty.current] }));
        }
      } catch {
        /* private mode — memory only */
      }
    };
    if (versioned) write();
    else persistTimer.current = window.setTimeout(write, 500);
  }

  useEffect(
    () => () => {
      if (persistTimer.current) window.clearTimeout(persistTimer.current);
      if (flushTimer.current) window.clearTimeout(flushTimer.current);
    },
    [],
  );
  const flushTimer = useRef<number | null>(null);

  // Debounced autosave: flush ~800ms after the last keystroke (batched via
  // /answers), on top of the 15s interval + part-change + submit flushes.
  function scheduleFlush() {
    if (flushTimer.current) window.clearTimeout(flushTimer.current);
    flushTimer.current = window.setTimeout(() => {
      void flush().catch(() => undefined);
    }, 800);
  }
  const submittingRef = useRef(false);
  const submittedRef = useRef(false);
  const dividerRef = useRef<HTMLDivElement | null>(null);

  // Clock skew measured once from the server timestamp in the start payload.
  const offsetMs = useMemo(() => serverOffsetMs(p.serverTime), [p.serverTime]);
  const [remaining, setRemaining] = useState<number | null>(() =>
    remainingMs(p.deadlineIso, offsetMs),
  );

  const allQuestions = useMemo(() => p.parts.flatMap((part) => part.questions), [p.parts]);
  const total = allQuestions.length;
  const answeredArr = useMemo(
    () => allQuestions.map((q) => isAnswered(answers[q.id], audioDone[q.id] ?? false)),
    [allQuestions, answers, audioDone],
  );
  const flaggedArr = useMemo(() => allQuestions.map((q) => flags[q.id] ?? false), [allQuestions, flags]);
  const uploadNotes = useMemo(() => {
    const out: Record<string, string> = {};
    if (!p.speakNote) return out;
    for (const q of allQuestions) {
      const note = p.speakNote(q.id);
      if (note) out[q.id] = note;
    }
    return out;
  }, [allQuestions, p]);

  const part = p.parts[partIdx] ?? null;
  const split = !!part?.passageText;

  // ---- autosave (debounced per answer, bulk flush, offline queue) ----
  const saveInFlight = useRef<Promise<void> | null>(null);
  const flush = useCallback(async function flushQueue(): Promise<void> {
    if (saveInFlight.current) { await saveInFlight.current; return flushQueue(); }
    const ids = [...dirty.current];
    if (ids.length === 0) return;
    setSaveState("saving");
    const payload = ids.map((id) => ({ questionId: id, response: answersRef.current[id] ?? "" }));
    const operation = (async () => {
    try {
      if (payload.length === 1) await p.saveOne(payload[0].questionId, payload[0].response);
      else await p.saveMany(payload);
      for (const item of payload) if (answersRef.current[item.questionId] === item.response) dirty.current.delete(item.questionId);
      persistQueue();
      if (dirty.current.size === 0) {
        try {
          localStorage.removeItem(queueKey(p.attemptId));
        } catch {
          /* ignore */
        }
        setSaveState(typeof navigator !== "undefined" && !navigator.onLine ? "offline" : "saved");
      }
    } catch (e) {
      for (const id of ids) dirty.current.add(id);
      persistQueue();
      setSaveState(typeof navigator !== "undefined" && !navigator.onLine ? "offline" : "saving");
      notifyExamAuthIssue(e);
      throw e;
    }
    })();
    saveInFlight.current = operation;
    try { await operation; } finally { saveInFlight.current = null; }
  }, [p]);

  function setAnswer(qid: string, value: string, immediate = false) {
    answersRef.current = { ...answersRef.current, [qid]: value };
    dirty.current.add(qid);
    persistQueue();
    setAnswers((a) => (a[qid] === value ? a : { ...a, [qid]: value }));
    if (allQuestions.some((q) => q.guidance)) { setSaveState('saving'); scheduleFlush(); return; }
    if (immediate) {
      setSaveState("saving");
      void p
        .saveOne(qid, value)
        .then(() => {
          if (answersRef.current[qid] === value) dirty.current.delete(qid);
          persistQueue();
          if (dirty.current.size === 0) setSaveState("saved");
        })
        .catch((e: unknown) => {
          dirty.current.add(qid);
          persistQueue();
          setSaveState("offline");
          if (!notifyExamAuthIssue(e)) setError(friendlyError(e));
        });
    } else {
      dirty.current.add(qid);
      setSaveState("saving");
      persistQueue();
      scheduleFlush();
    }
  }

  // Retry the offline queue when connectivity returns + periodic flush.
  useEffect(() => {
    const retry = () => {
      if (dirty.current.size > 0) {
        setSaveState("saving");
        void flush().catch(() => setSaveState("offline"));
      } else {
        setSaveState(typeof navigator !== "undefined" && !navigator.onLine ? "offline" : "saved");
      }
    };
    const id = window.setInterval(retry, 15000);
    window.addEventListener("online", retry);
    window.addEventListener("offline", retry);
    return () => {
      window.clearInterval(id);
      window.removeEventListener("online", retry);
      window.removeEventListener("offline", retry);
    };
  }, [flush]);

  // ---- countdown (server-corrected) + auto-submit ----
  const doSubmit = useCallback(
    async (auto: boolean) => {
      if (submittingRef.current || submittedRef.current) return;
      if (!auto && !confirm("Submit this section? You won't be able to change answers afterwards."))
        return;
      submittingRef.current = true;
      setSubmitting(true);
      setError(null);
      try {
        await flushBeforeSubmission(flush, { versioned, auto }, (e) => setError(friendlyError(e)));
        submittedRef.current = true;
        await p.submit();
      } catch (e) {
        submittedRef.current = false;
        submittingRef.current = false;
        setSubmitting(false);
        if (!notifyExamAuthIssue(e)) setError(friendlyError(e));
        else setError("Session expired — sign in again to finish submitting. Your answers are queued.");
      }
    },
    [flush, p, versioned],
  );

  useEffect(() => {
    if (p.deadlineIso == null) return;
    let nextRetry = 0;
    setRemaining(remainingMs(p.deadlineIso, offsetMs));
    const id = window.setInterval(() => {
      const r = remainingMs(p.deadlineIso, offsetMs);
      setRemaining(r);
      if (r != null && r <= 0) {
        if (!versioned) window.clearInterval(id);
        if (Date.now() < nextRetry) return;
        nextRetry = Date.now() + 10000;
        setTimeUp(true);
        void doSubmit(true);
      }
    }, 1000);
    return () => window.clearInterval(id);
  }, [p.deadlineIso, offsetMs, doSubmit, versioned]);

  // ---- navigation ----
  function gotoPart(i: number, qGlobal?: number) {
    const clamped = Math.min(Math.max(0, i), p.parts.length - 1);
    setPartIdx(clamped);
    if (qGlobal != null) {
      setCurrentQ(qGlobal);
      requestAnimationFrame(() => {
        document.getElementById(`q-${allQuestions[qGlobal]?.number}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
      });
    }
  }

  function jumpQ(globalIndex: number) {
    let acc = 0;
    for (let i = 0; i < p.parts.length; i++) {
      const len = p.parts[i].questions.length;
      if (globalIndex < acc + len) {
        gotoPart(i, globalIndex);
        return;
      }
      acc += len;
    }
  }

  function stepPart(dir: -1 | 1) {
    const next = Math.min(p.parts.length - 1, Math.max(0, partIdx + dir));
    if (next === partIdx) return;
    void flush().catch((e: unknown) => setError(friendlyError(e)));
    setPartIdx(next);
    // Focus the first question of the new part.
    let acc = 0;
    for (let i = 0; i < next; i++) acc += p.parts[i].questions.length;
    setCurrentQ(acc);
    window.scrollTo({ top: 0 });
  }

  function toggleFlagById(qid: string) {
    setFlags((f) => ({ ...f, [qid]: !f[qid] }));
  }

  // ---- volume mirror (TopBar slider <-> engine) ----
  useEffect(() => {
    const onVol = (e: Event) => setVolumeState((e as CustomEvent<number>).detail);
    window.addEventListener(VOLUME_EVENT, onVol);
    return () => window.removeEventListener(VOLUME_EVENT, onVol);
  }, []);

  // ---- draggable divider ----
  useEffect(() => {
    const bar = dividerRef.current;
    if (!bar) return;
    let dragging = false;
    const pct = (clientX: number) => {
      const box = bar.parentElement?.getBoundingClientRect();
      if (!box || box.width <= 0) return;
      setLeftWidth(Math.min(70, Math.max(30, Math.round(((clientX - box.left) / box.width) * 100))));
    };
    const move = (e: MouseEvent) => dragging && pct(e.clientX);
    const touch = (e: TouchEvent) => {
      if (dragging && e.touches[0]) pct(e.touches[0].clientX);
    };
    const down = (e: MouseEvent) => {
      e.preventDefault();
      dragging = true;
    };
    const up = () => {
      dragging = false;
    };
    bar.addEventListener("mousedown", down);
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
    window.addEventListener("touchmove", touch, { passive: true });
    window.addEventListener("touchend", up);
    return () => {
      bar.removeEventListener("mousedown", down);
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
      window.removeEventListener("touchmove", touch);
      window.removeEventListener("touchend", up);
    };
  }, [split]);

  if (!part) {
    return (
      <section className="exam-empty">
        <p>This section has no parts yet.</p>
      </section>
    );
  }

  const gapped = hasGappedDocument(part.contentHtml);
  const gappedNums = gapped && part.contentHtml ? new Set(gapNumbersIn(part.contentHtml)) : new Set<number>();
  const cardQuestions = gapped ? part.questions.filter((q) => !gappedNums.has(q.number)) : part.questions;

  return (
    <div className="exam-shell" data-exam-theme={dark ? "dark" : "light"}>
      <TopBar
        back={p.onBack ? { label: "Sections", onClick: p.onBack } : null}
        candidateName={p.candidateName}
        sectionTitle={p.sectionTitle}
        partLabel={part.label}
        remainingMs={remaining}
        timeUp={timeUp}
        volumeVisible={p.showVolume}
        volume={volume}
        onVolume={(v) => setVolume(v)}
        fontSize={fontSize}
        onFontSize={(px) => setFontSize(Math.min(20, Math.max(14, px)))}
        dark={dark}
        onToggleDark={() => setDark((d) => !d)}
        saveState={saveState}
        onHelp={() => setHelpOpen(true)}
        onExit={p.onExit}
      />

      {timeUp && (
        <p className="exam-timeup" role="alert">
          Time is up — submitting now. Your saved answers are safe.
        </p>
      )}

      <main className="exam-body">
        {split ? (
          <div className="exam-split" style={{ gridTemplateColumns: `${leftWidth}% 8px ${100 - leftWidth}%` }}>
            <div className="exam-pane exam-pane-left">
              <div className="exam-pane-head">
                <span>{part.title ?? part.label}</span>
                <button type="button" onClick={() => setNoteOpen((v) => !v)} aria-pressed={noteOpen} className="exam-btn-ghost exam-btn-xs">
                  {noteOpen ? "Hide notes" : "Notes"}
                </button>
              </div>
              <div className="exam-pane-scroll">
                {part.passageText && (
                  <PassagePane
                    partKey={part.key}
                    passageText={part.passageText}
                    fontSize={fontSize}
                    storageKey={p.storageKey}
                    onPersist={p.persistMarks}
                    noteOpen={noteOpen}
                    onToggleNote={() => setNoteOpen((v) => !v)}
                  />
                )}
              </div>
            </div>
            <div
              ref={dividerRef}
              role="separator"
              aria-orientation="vertical"
              aria-label="Resize panes"
              title="Drag to resize · double-click to reset"
              onDoubleClick={() => setLeftWidth(50)}
              className="exam-divider"
            />
            <div className="exam-pane exam-pane-right">
              <div className="exam-pane-scroll">
                <PartQuestions
                  part={part}
                  gapped={gapped}
                  cardQuestions={cardQuestions}
                  answers={answers}
                  flags={flags}
                  uploadNotes={uploadNotes}
                  fontSize={fontSize}
                  onAnswer={setAnswer}
                  onToggleFlag={toggleFlagById}
                  onSpeakBlob={p.onSpeakBlob}
                />
              </div>
            </div>
          </div>
        ) : (
          <div className="exam-single">
            <PartQuestions
              part={part}
              gapped={gapped}
              cardQuestions={cardQuestions}
              answers={answers}
              flags={flags}
              uploadNotes={uploadNotes}
              fontSize={fontSize}
              onAnswer={setAnswer}
              onToggleFlag={toggleFlagById}
              onSpeakBlob={p.onSpeakBlob}
            />
          </div>
        )}
      </main>

      {error && (
        <p role="alert" className="exam-error">
          {error}
        </p>
      )}

      <BottomNav
        parts={p.parts.map((x) => ({
          label: x.label,
          answered: x.questions.filter((q) => isAnswered(answers[q.id], audioDone[q.id] ?? false)).length,
          total: x.questions.length,
        }))}
        currentPart={partIdx}
        onPart={(i) => gotoPart(i)}
        answered={answeredArr}
        flagged={flaggedArr}
        currentQ={currentQ}
        onJumpQ={jumpQ}
        onToggleFlag={(gi) => {
          const q = allQuestions[gi];
          if (q) toggleFlagById(q.id);
        }}
        onPrev={() => stepPart(-1)}
        onNext={() => {
          const nxt = nextUnanswered(total, currentQ, answeredArr);
          if (nxt != null) jumpQ(nxt);
          else stepPart(1);
        }}
        canPrev={partIdx > 0}
        isLastPart={partIdx >= p.parts.length - 1}
        submitting={submitting}
        submitLabel={p.submitLabel}
        onSubmit={() => void doSubmit(false)}
      />

      {helpOpen && (
        <div className="exam-help" role="dialog" aria-label="Exam help" onClick={() => setHelpOpen(false)}>
          <div className="exam-help-card" onClick={(e) => e.stopPropagation()}>
            <h2>How this exam works</h2>
            <ul>
              <li>Use the number buttons below to jump between questions.</li>
              <li>Flag questions to review them before submitting.</li>
              <li>Answers save automatically — watch the Saved indicator.</li>
              <li>Listening audio in timed sections plays once only.</li>
            </ul>
            <button type="button" onClick={() => setHelpOpen(false)} className="exam-btn-primary">
              Close
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/** Per-part material + questions (split right pane or single column). */
export function PartQuestions(props: {
  part: UIPart;
  gapped: boolean;
  cardQuestions: UIPart["questions"];
  answers: Record<string, string>;
  flags: Record<string, boolean>;
  uploadNotes: Record<string, string>;
  fontSize: number;
  onAnswer: (qid: string, value: string, immediate?: boolean) => void;
  onToggleFlag: (qid: string) => void;
  onSpeakBlob?: (qid: string, blob: Blob) => void;
}) {
  const { part } = props;
  const onAnswer = props.onAnswer;
  const questionsById = new Map(part.questions.map((q) => [q.id, q]));
  return (
    <div>
      {part.audioUrl && (
        part.multilevelAudio ? <MultilevelListening
          key={`${part.multilevelAudio.attemptId}:${part.multilevelAudio.groupId}`}
          prepare={() => post<MediaPhase>(`/mock/attempts/${part.multilevelAudio!.attemptId}/listening/${part.multilevelAudio!.groupId}/prepare`, {})}
          play={() => post<MediaPhase>(`/mock/attempts/${part.multilevelAudio!.attemptId}/listening/${part.multilevelAudio!.groupId}/play`, {})}
          load={() => fetchAuthenticatedMedia(part.audioUrl!)}
        /> : <ListeningEngine
          src={part.audioUrl}
          title={part.title ?? part.label}
          strict={part.strictAudio}
        />
      )}
      {part.imageUrl && !part.questions.some((q) => q.kind === "map_label") && (
        <BlobImage src={part.imageUrl} alt="" className="exam-figure" />
      )}
      {props.gapped && part.contentHtml && (
        <div className="exam-gapped-card">
          <GappedContent
            contentHtml={part.contentHtml}
            questions={part.questions}
            renderGap={({ number, question }) =>
              question ? (
                <span className="exam-gap">
                  <span className="exam-gapnum">{number}</span>
                  <GapInput
                    qid={question.id}
                    number={number}
                    value={props.answers[question.id] ?? ""}
                    wordLimit={questionsById.get(question.id)?.wordLimit ?? null}
                    answerRule={questionsById.get(question.id)?.answerRule}
                    fontSize={props.fontSize}
                    onChange={(v) => onAnswer(question.id, v)}
                  />
                </span>
              ) : (
                <span className="exam-gap-orphan" role="alert">
                  Q{number}
                </span>
              )
            }
          />
        </div>
      )}
      <QuestionGroup
        part={part}
        only={props.gapped ? props.cardQuestions : undefined}
        answers={props.answers}
        flags={props.flags}
        uploadNotes={props.uploadNotes}
        fontSize={props.fontSize}
        onAnswer={onAnswer}
        onToggleFlag={props.onToggleFlag}
        onSpeakBlob={props.onSpeakBlob}
      />
    </div>
  );
}

/** Inline gap input with word-limit hint. */
function GapInput(props: {
  qid: string;
  number: number;
  value: string;
  wordLimit: number | null;
  answerRule?: AnswerRule | null;
  fontSize: number;
  onChange: (v: string) => void;
}) {
  const over = exceedsAnswerConstraint(props.value, props);
  return (
    <input
      value={props.value}
      onChange={(e) => props.onChange(e.target.value)}
      aria-label={`Answer for question ${props.number}`}
      autoComplete="off"
      spellCheck={false}
      aria-invalid={over || undefined}
      title={answerRuleHint(props) ?? undefined}
      className={`exam-gapinput${over ? " exam-input-over" : ""}`}
      style={{ fontSize: 14 }}
    />
  );
}
