import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { get, post } from "../lib/api";
import {
  downloadVocabularyForOffline,
  enqueueFlashcardMutation,
  getOfflineProgress,
  getOfflineSnapshot,
  getPendingMutations,
  listOfflineSnapshots,
  removeOfflineSnapshot,
  saveOnlineFlashcardChange,
  syncOfflineFlashcards,
} from "../lib/offline-vocabulary";
import { useSessionStore } from "../lib/session-store";
import type {
  VocabularyCard, VocabularyFlashcards, VocabularyMode, VocabularyQuestion, VocabularyResult,
  VocabularyLearnerHistory, VocabularyReview, VocabularyReviewHistory, VocabularySession, VocabularySubmission,
} from "../lib/group-contract.generated";

const control = "rounded-lg border border-white/15 bg-surface px-3 py-2 text-sm focus-visible:outline-2 focus-visible:outline-emerald-300 disabled:opacity-50";
const labels: Record<VocabularyMode, string> = {
  mixed: "Mixed practice", spelling: "Spelling", eng_uzb: "English to Uzbek", uzb_eng: "Uzbek to English",
};

function errorMessage(error: unknown) {
  return typeof error === "object" && error && "message" in error ? String(error.message) : "Request failed.";
}

function Result({ result }: { result: VocabularyResult }) {
  return (
    <section className="card space-y-3 rounded-2xl p-4" aria-label="Vocabulary result">
      <h2 className="text-lg font-semibold">Vocabulary result</h2>
      <p>{result.score} / {result.totalWords} · {result.percentage}%</p>
      {result.wrongAnswers.length > 0 && <ul className="space-y-1">
        {result.wrongAnswers.map(word => <li key={word.wordId}>{word.english} — {word.uzbek}</li>)}
      </ul>}
    </section>
  );
}

function Practice({
  sessionId, questions, path, onComplete,
}: { sessionId: string; questions: VocabularyQuestion[]; path: string; onComplete: () => void }) {
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [index, setIndex] = useState(0);
  const prompt = useRef<HTMLLegendElement>(null);
  useEffect(() => { prompt.current?.focus(); }, [index]);
  const save = useMutation({
    mutationFn: (payload: VocabularySubmission) => post<VocabularyResult>(path, payload),
    onSuccess: onComplete,
  });
  if (save.data) return <Result result={save.data} />;

  const question = questions[index];
  if (!question) return <p>No words are due for review.</p>;
  const complete = questions.every(item => Boolean(answers[item.wordId]?.trim()));

  function submit(event: FormEvent) {
    event.preventDefault();
    if (!complete || save.isPending) return;
    save.mutate({
      sessionId,
      answers: questions.map(item => ({ wordId: item.wordId, answer: answers[item.wordId] })),
    });
  }

  return (
    <form className="card space-y-4 rounded-2xl p-4" onSubmit={submit}>
      <p aria-live="polite">Question {index + 1} / {questions.length}</p>
      <fieldset className="space-y-2" disabled={save.isPending}>
        <legend ref={prompt} tabIndex={-1} className="mb-2 text-lg font-semibold focus-visible:outline-2 focus-visible:outline-emerald-300">{question.prompt}</legend>
        {question.options.length ? question.options.map(option => (
          <label className="flex gap-2" key={option}>
            <input name="answer" type="radio" checked={answers[question.wordId] === option} onChange={() => setAnswers({ ...answers, [question.wordId]: option })} />
            {option}
          </label>
        )) : <label className="grid gap-1">
          Answer
          <input className={control} value={answers[question.wordId] ?? ""} maxLength={500} onChange={event => setAnswers({ ...answers, [question.wordId]: event.target.value })} />
        </label>}
      </fieldset>
      <div className="flex flex-wrap gap-2">
        <button className={control} type="button" disabled={!index || save.isPending} onClick={() => setIndex(index - 1)}>Previous</button>
        <button className={control} type="button" disabled={index + 1 === questions.length || !answers[question.wordId]?.trim() || save.isPending} onClick={() => setIndex(index + 1)}>Next question</button>
        <button className="btn-brand px-4 py-2 disabled:opacity-50" disabled={!complete || save.isPending}>
          {save.isPending ? "Submitting…" : "Submit answers"}
        </button>
      </div>
      {save.isError && <p role="alert">{errorMessage(save.error)}</p>}
    </form>
  );
}

function Assignment({ id, userId, onComplete }: { id: string; userId: string; onComplete: () => void }) {
  const root = `/v1/student/assignments/${encodeURIComponent(id)}/vocabulary`;
  const queryClient = useQueryClient();

  // Queries for server data
  const words = useQuery({
    queryKey: ["assigned-vocabulary-words", userId, id],
    queryFn: ({ signal }) => get<VocabularyCard[]>(root + "/words", undefined, { signal }),
    retry: 1,
  });
  const session = useMutation({ mutationFn: (mode: VocabularyMode) => post<VocabularySession>(root, { mode }) });
  const progressKey = ["vocabulary-flashcards", userId, id] as const;
  const progress = useQuery({
    queryKey: progressKey,
    queryFn: ({ signal }) => get<VocabularyFlashcards>(root + "/flashcards", undefined, { signal }),
    refetchOnWindowFocus: true,
    retry: 1,
  });

  // Local durable offline store
  const localSnapshot = useQuery({
    queryKey: ["offline-vocab-snapshot", userId, id],
    networkMode: "always",
    queryFn: () => getOfflineSnapshot(userId, id),
  });
  const localProgress = useQuery({
    queryKey: ["offline-vocab-progress", userId, id],
    networkMode: "always",
    queryFn: () => getOfflineProgress(userId, id),
  });
  const pendingOps = useQuery({
    queryKey: ["offline-vocab-pending", userId, id],
    networkMode: "always",
    queryFn: () => getPendingMutations(userId, id),
  });

  // Sync state & mutations
  const [syncStatus, setSyncStatus] = useState<"idle" | "syncing" | "success" | "error">("idle");
  const isOnline = useSessionStore((state) => state.online);

  const [storageError, setStorageError] = useState(false);
  const accessDenied = words.error && typeof words.error === "object" && "status" in words.error
    && [401, 403, 404, 410].includes(Number(words.error.status));
  useEffect(() => {
    if (!accessDenied || !localSnapshot.data) return;
    void removeOfflineSnapshot(userId, id).then(() => {
      void queryClient.invalidateQueries({ queryKey: ["offline-vocab-snapshot", userId, id] });
      void queryClient.invalidateQueries({ queryKey: ["offline-vocab-assignments", userId] });
    }).catch(() => setStorageError(true));
  }, [accessDenied, id, localSnapshot.data, queryClient, userId]);
  const effectiveWords: VocabularyCard[] = accessDenied ? [] : words.data ?? localSnapshot.data?.words ?? [];
  const effectiveProgress = pendingOps.data?.length
    ? localProgress.data ?? progress.data
    : progress.data ?? localProgress.data;
  const study = effectiveProgress ?? { lastWordId: "", familiarity: {}, order: [], lastStudiedAt: null };

  const order = study.order?.length
    ? study.order
    : effectiveWords.map(w => w.id);

  const index = Math.max(0, order.indexOf(study.lastWordId || ""));
  const word = effectiveWords.find(item => item.id === order[index]);

  const [revealed, setRevealed] = useState(false);
  const [muted, setMuted] = useState(false);
  const [audioErrorFor, setAudioErrorFor] = useState<string>();
  const audio = useRef<HTMLAudioElement>(null);
  const canSpeak = !!window.speechSynthesis && !!window.SpeechSynthesisUtterance;

  // Trigger durable offline sync
  const triggerSync = useCallback(async () => {
    setSyncStatus("syncing");
    try {
      let res = await syncOfflineFlashcards(userId, id);
      while (res.success && res.acknowledgedCount > 0 && res.remainingCount) {
        res = await syncOfflineFlashcards(userId, id);
      }
      void queryClient.invalidateQueries({ queryKey: ["offline-vocab-pending", userId, id] });
      void queryClient.invalidateQueries({ queryKey: ["offline-vocab-progress", userId, id] });
      void queryClient.invalidateQueries({ queryKey: progressKey });
      const complete = res.success && res.remainingCount === 0;
      const assignmentListKey = ["vocabulary-assignments", userId];
      if (complete && queryClient.getQueryState(assignmentListKey)?.status === "error") {
        void queryClient.invalidateQueries({ queryKey: assignmentListKey });
      }
      setSyncStatus(complete ? "success" : "error");
    } catch {
      setSyncStatus("error");
    }
  }, [userId, id, queryClient, progressKey]);

  // Attempt sync on reconnect
  useEffect(() => {
    const handleOnline = () => { void triggerSync(); };
    window.addEventListener("online", handleOnline);
    return () => window.removeEventListener("online", handleOnline);
  }, [triggerSync]);

  const downloadMutation = useMutation({
    mutationFn: () => downloadVocabularyForOffline(userId, id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["offline-vocab-snapshot", userId, id] });
      void queryClient.invalidateQueries({ queryKey: ["offline-vocab-progress", userId, id] });
    },
  });

  async function pronounce() {
    if (muted || !word) return;
    setAudioErrorFor(undefined);
    const recording = audio.current;
    if (recording) {
      try {
        if (recording.readyState) recording.currentTime = 0;
        await recording.play();
        return;
      } catch (error) {
        if (recording !== audio.current || recording.muted || (error instanceof DOMException && error.name === "AbortError")) return;
      }
    }
    if (!canSpeak) {
      setAudioErrorFor(word.id);
      return;
    }
    const utterance = new SpeechSynthesisUtterance(word.english);
    utterance.lang = "en-US";
    utterance.onerror = event => {
      if (event.error !== "canceled" && event.error !== "interrupted") setAudioErrorFor(word.id);
    };
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(utterance);
  }

  async function saveChange(change: { wordId?: string; status?: "known" | "practice"; lastWordId?: string; order?: string[] }) {
    if (accessDenied) return;
    setStorageError(false);
    try {
      await enqueueFlashcardMutation(userId, id, change, study);
    } catch {
      // Keep server-only study working when durable storage cannot be opened.
      if (navigator.onLine && pendingOps.isSuccess && pendingOps.data.length === 0) {
        try {
          const saved = await saveOnlineFlashcardChange(userId, id, change);
          queryClient.setQueryData(progressKey, saved);
          setRevealed(false);
          return;
        } catch {
          setStorageError(true);
          return;
        }
      }
      setStorageError(true);
      return;
    }
    void queryClient.invalidateQueries({ queryKey: ["offline-vocab-progress", userId, id] });
    void queryClient.invalidateQueries({ queryKey: ["offline-vocab-pending", userId, id] });
    setRevealed(false);
    if (navigator.onLine) void triggerSync();
  }

  async function cardBy(step: number) {
    if (!order.length) return;
    await saveChange({ lastWordId: order[(index + step + order.length) % order.length] });
  }

  async function shuffle() {
    if (!order.length) return;
    const shuffled = [...order];
    for (let i = shuffled.length - 1; i > 0; i--) {
      const other = Math.floor(Math.random() * (i + 1));
      [shuffled[i], shuffled[other]] = [shuffled[other], shuffled[i]];
    }
    await saveChange({ order: shuffled, lastWordId: shuffled[0] });
  }

  async function setFamiliarity(status: "known" | "practice") {
    if (word) await saveChange({ wordId: word.id, status, lastWordId: word.id });
  }

  // Keyboard accessibility
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.target instanceof Element && e.target.closest("button, a, input, textarea, select, [contenteditable]")) return;
      if (!word || accessDenied) return;
      if (e.key === " " || e.key === "Enter") {
        e.preventDefault();
        setRevealed(prev => !prev);
      } else if (e.key === "ArrowLeft") {
        e.preventDefault();
        void cardBy(-1);
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        void cardBy(1);
      } else if (e.key === "1" || e.key.toLowerCase() === "k") {
        void setFamiliarity("known");
      } else if (e.key === "2" || e.key.toLowerCase() === "p") {
        void setFamiliarity("practice");
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [word, index, order, accessDenied]);

  const pendingCount = pendingOps.data?.length ?? 0;
  const isDownloaded = Boolean(localSnapshot.data) && !accessDenied;

  return (
    <div className="space-y-4">
      {session.data?.result ? <Result result={session.data.result} /> : session.data ? (
        <Practice sessionId={session.data.sessionId} questions={session.data.questions} path={root + "/submit"} onComplete={onComplete} />
      ) : (
        <>
      {accessDenied && <p role="alert">Vazifaga kirish yopilgan / Assignment access is unavailable.</p>}
      {(storageError || pendingOps.isError) && <p role="alert">Oflayn o‘zgarish saqlanmadi / Offline progress could not be saved.</p>}
      {downloadMutation.isError && <p role="alert">Oflayn yuklab bo‘lmadi / Offline download failed.</p>}
      {syncStatus === "error" && <p role="alert">Sinxronlash tugamadi / Sync incomplete. Retry when online.</p>}
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap gap-2">
              {(Object.keys(labels) as VocabularyMode[]).map(mode => (
                <button className={control} type="button" key={mode} disabled={!isOnline || Boolean(accessDenied) || session.isPending} onClick={() => session.mutate(mode)}>{labels[mode]}</button>
              ))}
            </div>

            <div className="flex flex-wrap items-center gap-2 text-xs" aria-live="polite">
              {isDownloaded ? (
                <span className="rounded-md bg-emerald-500/10 px-2 py-1 text-emerald-400 border border-emerald-500/20" title="Offline study available">
                  ✓ Oflayn tayyor / Offline ready
                </span>
              ) : (
                <button
                  type="button"
                  className={control + " text-xs"}
                  disabled={!isOnline || Boolean(accessDenied) || downloadMutation.isPending}
                  onClick={() => downloadMutation.mutate()}
                >
                  {downloadMutation.isPending ? "Yuklanmoqda… / Downloading…" : "↓ Oflayn saqlash / Save offline"}
                </button>
              )}

              {pendingCount > 0 ? (
                <button
                  type="button"
                  className="workspace-control text-warning"
                  onClick={() => void triggerSync()}
                  disabled={!isOnline || Boolean(accessDenied) || syncStatus === "syncing"}
                >
                  {syncStatus === "syncing" ? "Sinxronlanmoqda…" : `↻ ${pendingCount} kutilmoqda / pending`}
                </button>
              ) : (
                <span className="rounded-md bg-white/5 px-2 py-1 text-white/60">
                  {isOnline ? "● Onlayn / Online" : "○ Oflayn / Offline"}
                </span>
              )}
            </div>
          </div>

          {session.isError && <p role="alert">{errorMessage(session.error)}</p>}

          <section className="workspace-panel space-y-3 p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-lg font-semibold">Flashcards</h2>
              {effectiveWords.length > 0 && (
                <span className="text-xs text-white/60">
                  {Object.values(study.familiarity || {}).filter(v => v === "known").length} / {effectiveWords.length} o‘rganilgan / known
                </span>
              )}
            </div>

            {effectiveWords.length === 0 && (words.isPending || progress.isPending) && (
              <p role="status">So‘zlar yuklanmoqda / Loading words…</p>
            )}

            {effectiveWords.length === 0 && words.isError && !localSnapshot.data && (
              <p role="alert">{errorMessage(words.error)} <button className={control} onClick={() => void words.refetch()}>Qayta urinish / Retry</button></p>
            )}

            {word && (
              <>
                <button
                  className="workspace-control min-h-28 w-full break-words text-xl font-semibold tracking-wide"
                  type="button"
                  aria-pressed={revealed}
                  onClick={() => setRevealed(!revealed)}
                >
                  {revealed ? word.uzbek : word.english}
                </button>

                {revealed && <div className="space-y-1 text-sm rounded-lg bg-white/5 p-3">
                  {word.definition && <p><span className="text-white/60">Izoh / Def:</span> {word.definition}</p>}
                  {word.contextSentence && <p><span className="text-white/60">Misol / Ex:</span> {word.contextSentence}</p>}
                  {word.synonyms?.length ? <p><span className="text-white/60">Sinonim:</span> {word.synonyms.join(", ")}</p> : null}
                  {word.pronunciation && <p className="font-mono text-emerald-400">/{word.pronunciation}/</p>}
                  {word.level && <span className="inline-block rounded bg-white/10 px-1.5 py-0.5 text-xs">{word.level}</span>}
                </div>}

                <div className="flex flex-wrap items-center gap-2 pt-2">
                  <button className={control} type="button" onClick={() => void cardBy(-1)}>
                    ← Oldingi / Prev
                  </button>
                  <span aria-live="polite" className="px-2 text-sm font-medium tabular-nums">
                    {index + 1} / {order.length}
                  </span>
                  <button className={control} type="button" onClick={() => void cardBy(1)}>
                    Keyingi / Next →
                  </button>
                  <button className={control} type="button" onClick={() => void shuffle()}>
                    Aralashtirish / Shuffle
                  </button>

                  <button
                    className={`${control} ${study.familiarity[word.id] === "known" ? "bg-emerald-600/30 border-emerald-500 text-emerald-300" : ""}`}
                    type="button"
                    aria-pressed={study.familiarity[word.id] === "known"}
                    onClick={() => void setFamiliarity("known")}
                  >
                    ✓ Bilaman / Known
                  </button>
                  <button
                    className={`${control} ${study.familiarity[word.id] === "practice" ? "bg-amber-600/30 border-amber-500 text-amber-300" : ""}`}
                    type="button"
                    onClick={() => void setFamiliarity("practice")}
                  >
                    ? Mashq kerak / Need practice
                  </button>

                  {(word.audioUrl || canSpeak) && (
                    <>
                      <button className={control} type="button" onClick={() => void pronounce()} disabled={muted}>
                        🔊 Talaffuz / Pronounce
                      </button>
                      <button className={control} type="button" aria-pressed={muted} onClick={() => {
                        audio.current?.pause();
                        window.speechSynthesis?.cancel();
                        setMuted(!muted);
                      }}>{muted ? "Unmute" : "Mute"}</button>
                    </>
                  )}
                </div>

                {word.audioUrl && <audio key={word.id} ref={audio} muted={muted} preload="none" src={word.audioUrl} />}
                {audioErrorFor === word.id && <p role="status" className="text-xs text-amber-400">Talaffuz audiosi mavjud emas / Audio unavailable.</p>}

                <div className="text-xs text-white/40 pt-1">
                  Klaviatura: [Bo‘shliq/Enter] ochish · [←/→] o‘tish · [1/K] bilaman · [2/P] mashq
                </div>
              </>
            )}
          </section>
        </>
      )}
    </div>
  );
}

function LearningHistory({ userId, review = false }: { userId: string; review?: boolean }) {
  const [page, setPage] = useState(1);
  const history = useQuery<VocabularyReviewHistory | VocabularyLearnerHistory>({
    queryKey: ["vocabulary-history", userId, review, page],
    queryFn: () => review
      ? get<VocabularyReviewHistory>("/v1/vocabulary/srs/history", { page, limit: 10 })
      : get<VocabularyLearnerHistory>("/v1/student/vocabulary/history", { page, limit: 10 }),
  });
  return (
    <section className="card space-y-3 rounded-2xl p-4">
      <h2 className="font-semibold">{review ? "Review history" : "Vocabulary results history"}</h2>
      {history.isPending && <p role="status">Loading history…</p>}
      {history.isError && <p role="alert">{errorMessage(history.error)} <button className={control} onClick={() => void history.refetch()}>Retry</button></p>}
      {history.data && !history.data.entries.length && <p>No activity yet.</p>}
      <ul className="space-y-1">{history.data?.entries.map(row => "review__word__english" in row ? (
        <li key={row.id}>{row.review__word__english} · {row.correct ? "Correct" : "Incorrect"} · {row.interval_days} day(s) · {row.mastered ? "Mastered" : "Learning"} · Next {new Date(row.next_review_at).toLocaleString()}</li>
      ) : (
        <li key={row.assignment_id}>{row.assignment__title} · {row.score_percent}% · {new Date(row.completed_at).toLocaleDateString()}</li>
      ))}</ul>
      {history.data && (page > 1 || history.data.hasNext) && <div className="flex gap-2">
        <button className={control} disabled={page === 1} onClick={() => setPage(page - 1)}>Previous</button>
        <button className={control} disabled={!history.data.hasNext} onClick={() => setPage(page + 1)}>Next</button>
      </div>}
    </section>
  );
}

type AssignedTask = { id: string; title: string; vocabulary_set_id: string | null; score_percent: number | null; deadline: string };

export default function Vocabulary({ userId }: { userId: string }) {
  const queryClient = useQueryClient();
  const taskKey = ["vocabulary-assignments", userId] as const;
  const tasks = useQuery({
    queryKey: taskKey,
    queryFn: ({ signal }) => get<AssignedTask[]>("/v1/student/my-assignments", undefined, { signal }),
  });
  const [assignmentId, setAssignmentId] = useState("");
  const review = useMutation({ mutationFn: () => get<VocabularyReview>("/v1/vocabulary/srs/quiz") });
  const internetUnavailable = useSessionStore((state) => !state.online)
    || Boolean(tasks.error && typeof tasks.error === "object" && "status" in tasks.error && tasks.error.status === 0);
  const offlineAssignments = useQuery({
    queryKey: ["offline-vocab-assignments", userId],
    queryFn: () => listOfflineSnapshots(userId),
    enabled: internetUnavailable,
    networkMode: "always",
  });
  const assigned = tasks.isError ? undefined : tasks.data?.filter(task => task.vocabulary_set_id);
  const assignment = assigned?.find(task => task.id === assignmentId);
  const offlineAssignment = internetUnavailable
    ? offlineAssignments.data?.find(snapshot => snapshot.assignmentId === assignmentId) : undefined;

  return (
    <section className="space-y-4">
      <h1 className="text-2xl font-bold">Vocabulary</h1>
      <section className="card space-y-3 rounded-2xl p-4">
        <h2 className="text-lg font-semibold">Assigned vocabulary</h2>
        {internetUnavailable && (
          <div>
            <p className="text-sm">Oflayn to‘plamlar / Downloaded collections</p>
            {offlineAssignments.isError && <p role="alert">Oflayn to‘plamlar ochilmadi / Could not read downloads.</p>}
            <ul className="space-y-2">{offlineAssignments.data?.map(snapshot => (
              <li key={snapshot.assignmentId}>
                <button className={control} type="button" onClick={() => { review.reset(); setAssignmentId(snapshot.assignmentId); }}>
                  {snapshot.title}
                </button>
              </li>
            ))}</ul>
          </div>
        )}
        {tasks.isPending && !internetUnavailable && <p role="status">Loading assignments…</p>}
        {tasks.isError && <p role="alert">{errorMessage(tasks.error)} <button className={control} onClick={() => void tasks.refetch()}>Retry</button></p>}
        {tasks.isSuccess && !assigned?.length && <p>No vocabulary assignments.</p>}
        <ul className="space-y-2">{assigned?.map(task => (
          <li className="flex flex-wrap items-center justify-between gap-2" key={task.id}>
            <div>{task.title} <time className="block text-xs" dateTime={task.deadline}>{new Date(task.deadline).toLocaleString()}</time></div>
            <button className={control} type="button" onClick={() => { review.reset(); setAssignmentId(task.id); }}>
              {task.score_percent === null ? "Study vocabulary" : `Review result · ${task.score_percent}%`}
            </button>
          </li>
        ))}</ul>
      </section>
      {(assignment || offlineAssignment) && <Assignment key={assignmentId} id={assignmentId} userId={userId} onComplete={() => {
        void queryClient.invalidateQueries({ queryKey: taskKey });
        void queryClient.invalidateQueries({ queryKey: ["vocabulary-history", userId] });
      }} />}
      <section className="card space-y-3 rounded-2xl p-4">
        <h2 className="text-lg font-semibold">Daily review</h2>
        <button className={control} type="button" disabled={review.isPending} onClick={() => { setAssignmentId(""); review.mutate(); }}>
          {review.isPending ? "Loading review…" : "Start daily review"}
        </button>
        {review.isError && <p role="alert">{errorMessage(review.error)}</p>}
        {review.data && (review.data.sessionId ? (
          <Practice key={review.data.sessionId} sessionId={review.data.sessionId} questions={review.data.questions} path="/v1/vocabulary/srs/submit" onComplete={() => void queryClient.invalidateQueries({ queryKey: ["vocabulary-history", userId] })} />
        ) : <p>No words are due for review.</p>)}
      </section>
      <LearningHistory userId={userId} />
      <LearningHistory userId={userId} review />
    </section>
  );
}
