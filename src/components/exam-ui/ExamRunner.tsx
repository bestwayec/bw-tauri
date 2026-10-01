import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getVolume, setVolume, VOLUME_EVENT } from "@/lib/volume";
import BlobImage from "@/components/exam/BlobImage";
import GappedContent, { gapNumbersIn, hasGappedDocument } from "@/components/exam/GappedContent";
import BottomNav from "./BottomNav";
import ListeningEngine from "./ListeningEngine";
import PassagePane, { type PassageMarks } from "./PassagePane";
import QuestionGroup from "./QuestionGroup";
import TopBar, { type SaveState } from "./TopBar";
import { isAnswered, nextUnanswered, remainingMs, serverOffsetMs, type UIPart } from "./model";

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

/**
 * Unified IELTS exam runner (mock + legacy flows). Split-pane reading with
 * a draggable divider, question tabs + jump buttons, server-time deadlines,
 * offline-tolerant autosave, and a light-by-default theme.
 */
export default function ExamRunner(p: ExamRunnerProps) {
  const [partIdx, setPartIdx] = useState(0);
  const [answers, setAnswers] = useState<Record<string, string>>(() => p.initialAnswers);
  const [audioDone] = useState<Record<string, boolean>>(() => p.initialAudioDone ?? {});
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

  const dirty = useRef<Set<string>>(new Set());
  const answersRef = useRef(answers);
  useEffect(() => {
    answersRef.current = answers;
  }, [answers]);
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
  const flush = useCallback(async () => {
    const ids = [...dirty.current];
    if (ids.length === 0) return;
    dirty.current.clear();
    setSaveState("saving");
    const payload = ids.map((id) => ({ questionId: id, response: answersRef.current[id] ?? "" }));
    try {
      if (payload.length === 1) await p.saveOne(payload[0].questionId, payload[0].response);
      else await p.saveMany(payload);
      if (dirty.current.size === 0) setSaveState(typeof navigator !== "undefined" && !navigator.onLine ? "offline" : "saved");
    } catch (e) {
      for (const id of ids) dirty.current.add(id);
      setSaveState(typeof navigator !== "undefined" && !navigator.onLine ? "offline" : "saving");
      throw e;
    }
  }, [p]);

  function setAnswer(qid: string, value: string, immediate = false) {
    setAnswers((a) => (a[qid] === value ? a : { ...a, [qid]: value }));
    if (immediate) {
      setSaveState("saving");
      void p
        .saveOne(qid, value)
        .then(() => {
          if (dirty.current.size === 0) setSaveState("saved");
        })
        .catch((e: unknown) => {
          dirty.current.add(qid);
          setSaveState("offline");
          setError(friendlyError(e));
        });
    } else {
      dirty.current.add(qid);
      setSaveState("saving");
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
        try {
          await flush();
        } catch (e) {
          setError(friendlyError(e)); // save blocked (e.g. time-up) — submit anyway
        }
        submittedRef.current = true;
        await p.submit();
      } catch (e) {
        submittedRef.current = false;
        submittingRef.current = false;
        setSubmitting(false);
        setError(friendlyError(e));
      }
    },
    [flush, p],
  );

  useEffect(() => {
    if (p.deadlineIso == null) return;
    setRemaining(remainingMs(p.deadlineIso, offsetMs));
    const id = window.setInterval(() => {
      const r = remainingMs(p.deadlineIso, offsetMs);
      setRemaining(r);
      if (r != null && r <= 0) {
        window.clearInterval(id);
        setTimeUp(true);
        void doSubmit(true);
      }
    }, 1000);
    return () => window.clearInterval(id);
  }, [p.deadlineIso, offsetMs, doSubmit]);

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
function PartQuestions(props: {
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
  const limitById = new Map(part.questions.map((q) => [q.id, q.wordLimit]));
  return (
    <div>
      {part.audioUrl && (
        <ListeningEngine
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
                    wordLimit={limitById.get(question.id) ?? null}
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
  fontSize: number;
  onChange: (v: string) => void;
}) {
  const over = props.wordLimit != null && props.value.trim().split(/\s+/).filter(Boolean).length > props.wordLimit;
  return (
    <input
      value={props.value}
      onChange={(e) => props.onChange(e.target.value)}
      aria-label={`Answer for question ${props.number}`}
      autoComplete="off"
      spellCheck={false}
      aria-invalid={over || undefined}
      title={props.wordLimit != null ? `No more than ${props.wordLimit} words` : undefined}
      className={`exam-gapinput${over ? " exam-input-over" : ""}`}
      style={{ fontSize: 14 }}
    />
  );
}
