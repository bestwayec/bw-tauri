import { useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { get, post } from "../lib/api";
import type {
  VocabularyCard, VocabularyMode, VocabularyQuestion, VocabularyResult,
  VocabularyReview, VocabularySession, VocabularySubmission,
} from "../lib/group-contract.generated";

const control = "rounded-lg border border-white/15 bg-surface px-3 py-2 text-sm disabled:opacity-50";
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
        <legend className="mb-2 text-lg font-semibold">{question.prompt}</legend>
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
  const [index, setIndex] = useState(0);
  const [revealed, setRevealed] = useState(false);
  const [known, setKnown] = useState<Set<string>>(new Set());
  const [muted, setMuted] = useState(false);
  const word = words.data?.[index];
  const canSpeak = typeof window !== "undefined" && "speechSynthesis" in window;

  function speak() {
    if (!canSpeak || muted || !word) return;
    const utterance = new SpeechSynthesisUtterance(word.english);
    utterance.lang = "en-US";
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(utterance);
  }

  function cardBy(step: number) {
    const count = words.data?.length ?? 0;
    if (count) setIndex(current => (current + step + count) % count);
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
            {words.isPending && <p role="status">Loading words…</p>}
            {words.isError && <p role="alert">{errorMessage(words.error)} <button className={control} onClick={() => void words.refetch()}>Retry</button></p>}
            {word && (
              <>
                <button className={control + " min-h-20 w-full text-lg"} type="button" aria-pressed={revealed} onClick={() => setRevealed(!revealed)}>
                  {revealed ? word.uzbek : word.english}
                </button>
                {revealed && word.contextSentence && <p>{word.contextSentence}</p>}
                <div className="flex flex-wrap items-center gap-2">
                  <button className={control} type="button" onClick={() => cardBy(-1)}>Previous card</button>
                  <span aria-live="polite">{index + 1} / {words.data?.length}</span>
                  <button className={control} type="button" onClick={() => cardBy(1)}>Next card</button>
                  <button className={control} type="button" onClick={() => {
                    const updated = new Set(known);
                    if (updated.has(word.id)) updated.delete(word.id);
                    else updated.add(word.id);
                    setKnown(updated);
                  }}>{known.has(word.id) ? "Needs practice" : "Mark known for this study session"}</button>
                  {canSpeak && <>
                    <button className={control} type="button" onClick={speak} disabled={muted}>Pronounce</button>
                    <button className={control} type="button" aria-pressed={muted} onClick={() => {
                      window.speechSynthesis.cancel();
                      setMuted(!muted);
                    }}>{muted ? "Unmute" : "Mute"}</button>
                  </>}
                </div>
              </>
            )}
          </section>
        </>
      )}
    </div>
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
      {assignment && <Assignment key={assignment.id} id={assignment.id} userId={userId} onComplete={() => void queryClient.invalidateQueries({ queryKey: taskKey })} />}
      <section className="card space-y-3 rounded-2xl p-4">
        <h2 className="text-lg font-semibold">Daily review</h2>
        <button className={control} type="button" disabled={review.isPending} onClick={() => { setAssignmentId(""); review.mutate(); }}>
          {review.isPending ? "Loading review…" : "Start daily review"}
        </button>
        {review.isError && <p role="alert">{errorMessage(review.error)}</p>}
        {review.data && (review.data.sessionId ? (
          <Practice key={review.data.sessionId} sessionId={review.data.sessionId} questions={review.data.questions} path="/v1/vocabulary/srs/submit" onComplete={() => undefined} />
        ) : <p>No words are due for review.</p>)}
      </section>
    </section>
  );
}
