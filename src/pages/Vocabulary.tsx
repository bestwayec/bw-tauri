import { useEffect, useRef, useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { get, patch, post } from "../lib/api";
import type {
  VocabularyCard, VocabularyFlashcardChange, VocabularyFlashcards, VocabularyMode, VocabularyQuestion, VocabularyResult,
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
  const words = useQuery({
    queryKey: ["assigned-vocabulary-words", userId, id],
    queryFn: ({ signal }) => get<VocabularyCard[]>(root + "/words", undefined, { signal }),
  });
  const session = useMutation({ mutationFn: (mode: VocabularyMode) => post<VocabularySession>(root, { mode }) });
  const queryClient = useQueryClient();
  const progressKey = ["vocabulary-flashcards", userId, id] as const;
  const progress = useQuery({
    queryKey: progressKey,
    queryFn: ({ signal }) => get<VocabularyFlashcards>(root + "/flashcards", undefined, { signal }),
    refetchOnWindowFocus: true,
  });
  const saveProgress = useMutation({
    mutationFn: (body: VocabularyFlashcardChange) => patch<VocabularyFlashcards>(root + "/flashcards", body),
    onSuccess: data => queryClient.setQueryData(progressKey, data),
  });
  const [revealed, setRevealed] = useState(false);
  const [muted, setMuted] = useState(false);
  const [audioErrorFor, setAudioErrorFor] = useState<string>();
  const audio = useRef<HTMLAudioElement>(null);
  const order = progress.data?.order.length ? progress.data.order : words.data?.map(word => word.id) ?? [];
  const index = Math.max(0, order.indexOf(progress.data?.lastWordId ?? ""));
  const word = words.data?.find(item => item.id === order[index]);
  const canSpeak = !!window.speechSynthesis && !!window.SpeechSynthesisUtterance;

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

  function cardBy(step: number) {
    if (!order.length || saveProgress.isPending) return;
    saveProgress.mutate({ lastWordId: order[(index + step + order.length) % order.length] });
    setRevealed(false);
  }

  function shuffle() {
    const shuffled = [...order];
    for (let index = shuffled.length - 1; index > 0; index--) {
      const other = Math.floor(Math.random() * (index + 1));
      [shuffled[index], shuffled[other]] = [shuffled[other], shuffled[index]];
    }
    saveProgress.mutate({ order: shuffled, lastWordId: shuffled[0] });
    setRevealed(false);
  }

  return (
    <div className="space-y-4">
      {session.data?.result ? <Result result={session.data.result} /> : session.data ? (
        <Practice sessionId={session.data.sessionId} questions={session.data.questions} path={root + "/submit"} onComplete={onComplete} />
      ) : (
        <>
          <div className="flex flex-wrap gap-2">
            {(Object.keys(labels) as VocabularyMode[]).map(mode => (
              <button className={control} type="button" key={mode} disabled={session.isPending} onClick={() => session.mutate(mode)}>{labels[mode]}</button>
            ))}
          </div>
          {session.isError && <p role="alert">{errorMessage(session.error)}</p>}
          <section className="card space-y-3 rounded-2xl p-4">
            <h2 className="text-lg font-semibold">Flashcards</h2>
            {(words.isPending || progress.isPending) && <p role="status">Loading words…</p>}
            {words.isError && <p role="alert">{errorMessage(words.error)} <button className={control} onClick={() => void words.refetch()}>Retry</button></p>}
            {progress.isError && <p role="alert">{errorMessage(progress.error)} <button className={control} onClick={() => void progress.refetch()}>Retry</button></p>}
            {word && progress.isSuccess && (
              <>
                <button className={control + " min-h-20 w-full text-lg"} type="button" aria-pressed={revealed} onClick={() => setRevealed(!revealed)}>
                  {revealed ? word.uzbek : word.english}
                </button>
                {revealed && <div className="space-y-1 text-sm">
                  {word.definition && <p>{word.definition}</p>}
                  {word.contextSentence && <p>{word.contextSentence}</p>}
                  {word.synonyms?.length ? <p>{word.synonyms.join(", ")}</p> : null}
                  {word.pronunciation && <p>{word.pronunciation}</p>}
                  {word.level && <p>{word.level}</p>}
                </div>}
                <div className="flex flex-wrap items-center gap-2">
                  <button className={control} type="button" disabled={saveProgress.isPending} onClick={() => cardBy(-1)}>Previous card</button>
                  <span aria-live="polite">{index + 1} / {order.length}</span>
                  <button className={control} type="button" disabled={saveProgress.isPending} onClick={() => cardBy(1)}>Next card</button>
                  <button className={control} type="button" disabled={saveProgress.isPending} onClick={shuffle}>Shuffle cards</button>
                  {(["known", "practice"] as const).map(status => (
                    <button className={control} key={status} type="button" disabled={saveProgress.isPending}
                      aria-pressed={progress.data.familiarity[word.id] === status}
                      onClick={() => saveProgress.mutate({ lastWordId: word.id, wordId: word.id, status })}>{status === "known" ? "Known" : "Need practice"}</button>
                  ))}
                  {(word.audioUrl || canSpeak) && <>
                    <button className={control} type="button" onClick={() => void pronounce()} disabled={muted}>Pronounce</button>
                    <button className={control} type="button" aria-pressed={muted} onClick={() => {
                      audio.current?.pause();
                      window.speechSynthesis?.cancel();
                      setMuted(!muted);
                    }}>{muted ? "Unmute" : "Mute"}</button>
                  </>}
                </div>
                {word.audioUrl && <audio key={word.id} ref={audio} muted={muted} preload="none" src={word.audioUrl} />}
                {audioErrorFor === word.id && <p role="status">Pronunciation audio is unavailable.</p>}
                {saveProgress.isPending && <p role="status">
                  {saveProgress.isPaused ? "Offline. Keep this view open to sync when connected." : "Saving study progress…"}
                </p>}
                {saveProgress.isSuccess && <p role="status">Study progress saved</p>}
                {saveProgress.isError && <p role="alert">{errorMessage(saveProgress.error)}</p>}
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
  const assigned = tasks.isError ? undefined : tasks.data?.filter(task => task.vocabulary_set_id);
  const assignment = assigned?.find(task => task.id === assignmentId);

  return (
    <section className="space-y-4">
      <h1 className="text-2xl font-bold">Vocabulary</h1>
      <section className="card space-y-3 rounded-2xl p-4">
        <h2 className="text-lg font-semibold">Assigned vocabulary</h2>
        {tasks.isPending && <p role="status">Loading assignments…</p>}
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
      {assignment && <Assignment key={assignment.id} id={assignment.id} userId={userId} onComplete={() => {
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
