import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { get, post } from "@/lib/api";

export interface SubmissionItem {
  id: string;
  questionId: string;
  studentName: string;
  examTitle: string;
  examType: "IELTS" | "MULTILEVEL";
  skill: "writing" | "speaking";
  subType: string;
  submittedAt: string;
  status: "pending" | "graded";
  prompt: string;
  responseText: string;
  hasRecording: boolean;
  hasHandwriting: boolean;
  rawScore: boolean;
  maxScore: number;
  overallBand: number | null;
}

export interface SubmissionPage {
  items: SubmissionItem[];
  total: number;
}

const pageSize = 25;

function Review({ item, userId }: { item: SubmissionItem; userId: string }) {
  const client = useQueryClient();
  const [score, setScore] = useState("");
  const [feedback, setFeedback] = useState("");
  const [criteria, setCriteria] = useState({ c1: "", c2: "", c3: "", c4: "" });
  const labels = item.skill === "writing"
    ? ["Task response", "Coherence", "Vocabulary", "Grammar"]
    : ["Fluency", "Vocabulary", "Grammar", "Pronunciation"];
  const values = Object.values(criteria);
  const derivedBand = values.every((value) => value !== "")
    ? Math.round(values.reduce((sum, value) => sum + Number(value), 0) / 2) / 2 : null;
  const value = item.rawScore ? (score === "" ? null : Number(score)) : derivedBand;
  const grade = useMutation({
    mutationFn: () => post("/v1/teacher/submissions/" + encodeURIComponent(item.id) + "/grade", {
      questionId: item.questionId,
      score: value,
      criteriaScores: item.rawScore ? undefined : {
        c1: Number(criteria.c1), c2: Number(criteria.c2), c3: Number(criteria.c3), c4: Number(criteria.c4),
      },
      feedback,
    }),
    onSuccess: () => client.invalidateQueries({ queryKey: ["teacher-submissions", userId] }),
  });
  const protectedEvidence = item.hasRecording || item.hasHandwriting;
  return (
    <section className="card space-y-4 rounded-2xl border border-white/10 p-5 lg:col-span-8">
      <div>
        <h2 className="text-xl font-bold text-white">{item.studentName}</h2>
        <p className="text-sm text-slate-300">{item.examTitle} · {item.subType}</p>
      </div>
      {item.prompt && <p className="text-sm text-slate-200">{item.prompt}</p>}
      {item.responseText && (
        <div className="max-h-80 overflow-y-auto whitespace-pre-wrap rounded-xl bg-black/20 p-4 text-sm text-white">
          {item.responseText}
        </div>
      )}
      {protectedEvidence && (
        <p className="text-sm text-amber-200">
          Audio yoki qo‘lyozma uchun veb-saytdagi baholash oynasini oching.
          {" "}Open the assessment review on the website to grade the recording or handwriting.
        </p>
      )}
      {item.status === "graded" && (
        <p className="text-sm">{item.rawScore ? "Task score" : "Task band"} {item.overallBand ?? "—"}</p>
      )}
      {item.status === "pending" && !protectedEvidence && (
        <form className="space-y-4" onSubmit={(event) => { event.preventDefault(); grade.mutate(); }}>
          {item.rawScore ? (
          <label className="flex flex-wrap items-center gap-3 text-sm">
            Task score (0–{item.maxScore})
            <input required type="number" min={0} max={item.maxScore} step={0.5} value={score}
              onChange={(event) => setScore(event.target.value)} className="rounded border border-slate-500 bg-surface px-3 py-2" />
          </label>
          ) : (
            <fieldset className="grid gap-3 sm:grid-cols-2">
              <legend className="text-sm">Band criteria · 0–9</legend>
              {(Object.keys(criteria) as (keyof typeof criteria)[]).map((key, index) => (
                <label key={key} className="flex items-center justify-between gap-2 text-sm">
                  {labels[index]}
                  <input required type="number" min={0} max={9} step={0.5} value={criteria[key]}
                    onChange={(event) => setCriteria({ ...criteria, [key]: event.target.value })}
                    className="w-20 rounded border border-slate-500 bg-surface px-2 py-1" />
                </label>
              ))}
              <output className="text-sm">Task band {derivedBand ?? "—"}</output>
            </fieldset>
          )}
          <label className="block text-sm">
            Izoh / Feedback
            <textarea rows={3} maxLength={10000} value={feedback} onChange={(event) => setFeedback(event.target.value)}
              className="mt-2 w-full rounded border border-slate-500 bg-surface px-3 py-2" />
          </label>
          {grade.isError && (
            <p role="alert" className="text-rose-300">
              Bahoni saqlab bo‘lmadi / Could not save score.
              {" "}<button type="button" className="underline"
                onClick={() => void client.invalidateQueries({ queryKey: ["teacher-submissions", userId] })}>Yangilash / Refresh</button>
            </p>
          )}
          <button type="submit" disabled={grade.isPending || value === null || value > item.maxScore} className="btn-brand px-5 py-2.5 text-sm font-bold">
            {grade.isPending ? "Saqlanmoqda… / Saving…" : "Bahoni saqlash / Save score"}
          </button>
        </form>
      )}
    </section>
  );
}

export default function GradingQueue({ userId }: { userId: string }) {
  const [selection, setSelection] = useState("");
  const [skill, setSkill] = useState("");
  const [status, setStatus] = useState("pending");
  const [offset, setOffset] = useState(0);
  const queue = useQuery({
    queryKey: ["teacher-submissions", userId, skill, status, offset],
    queryFn: ({ signal }) => get<SubmissionPage>("/v1/teacher/submissions", {
      skill: skill || undefined, status, offset, limit: pageSize, withTotal: 1,
    }, { signal }),
  });
  const items = queue.data?.items ?? [];
  const total = queue.data?.total ?? 0;
  const selected = items.find((item) => item.id === selection) ?? items[0];

  return (
    <section className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <h1 className="text-2xl font-bold text-white">Baholash navbati / Grading queue</h1>
        <div className="flex gap-3 text-sm">
          <label>
            <span className="sr-only">Skill</span>
            <select value={skill} onChange={(event) => { setSkill(event.target.value); setOffset(0); }}
              className="rounded border border-slate-500 bg-surface p-2">
              <option value="">All skills</option>
              <option value="writing">Writing</option>
              <option value="speaking">Speaking</option>
            </select>
          </label>
          <label>
            <span className="sr-only">Status</span>
            <select value={status} onChange={(event) => { setStatus(event.target.value); setOffset(0); }}
              className="rounded border border-slate-500 bg-surface p-2">
              <option value="pending">Pending</option>
              <option value="graded">Graded</option>
            </select>
          </label>
        </div>
      </div>
      {queue.isPending && <p role="status">Yuklanmoqda… / Loading…</p>}
      {queue.isError && (
        <p role="alert">Navbatni yuklab bo‘lmadi / Could not load grading queue.
          {" "}<button type="button" className="underline" onClick={() => void queue.refetch()}>Qayta urinish / Retry</button>
        </p>
      )}
      {queue.isSuccess && total === 0 && <p>Topshiriqlar yo‘q / No submissions</p>}
      {queue.isSuccess && selected && (
        <div className="grid gap-4 lg:grid-cols-12">
          <ul className="max-h-[65vh] space-y-2 overflow-y-auto lg:col-span-4">
            {items.map((item) => (
              <li key={item.id}>
                <button type="button" aria-pressed={item.id === selected.id} onClick={() => setSelection(item.id)}
                  className="w-full rounded-xl border border-slate-600 p-3 text-left aria-pressed:border-emerald-400">
                  <span className="block font-semibold">{item.studentName}</span>
                  <span className="text-sm text-slate-300">{item.examTitle} · {item.skill}</span>
                </button>
              </li>
            ))}
          </ul>
          <Review key={JSON.stringify([selected.id, selected.questionId, selected.status])} item={selected} userId={userId} />
        </div>
      )}
      {(offset > 0 || total > pageSize) && (
        <nav aria-label="Submission pages" className="flex items-center gap-4 text-sm">
          <button type="button" disabled={offset === 0} onClick={() => setOffset(offset - pageSize)}>Oldingi / Previous</button>
          <span>{total} submissions</span>
          <button type="button" disabled={offset + pageSize >= total} onClick={() => setOffset(offset + pageSize)}>Keyingi / Next</button>
        </nav>
      )}
    </section>
  );
}
