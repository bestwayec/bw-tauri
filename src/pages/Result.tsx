import { useEffect, useState } from "react";
import AttemptReview from "@/components/exam/AttemptReview";
import { MOCK_SKILL_LABEL, type MockSkill } from "@/lib/mocks";

export interface MockResultSummary {
  skill: MockSkill;
  status: string;
  sectionBands: Record<string, number> | null;
  overallBand: number | null;
  cefrLevel: string | null;
  specificationVersion?: string;
  scoreMethod?: string;
  scoreVersion?: string;
  overallScore?: number | null;
  standardScores?: Record<string, { estimatedStandardScore: number }> | null;
}

type Props = {
  testTitle?: string | null;
  autoScore?: number | null;
  maxScore?: number | null;
  attemptId?: string | null;
  mock?: MockResultSummary | null;
  onBack: () => void;
  onHistory: () => void;
};

function ScoreRing({ score, max }: { score: number; max: number | null }) {
  const [shown, setShown] = useState(0);
  const pct = max && max > 0 ? Math.min(1, score / max) : null;

  useEffect(() => {
    let frame = 0;
    const t0 = performance.now();
    const tick = (t: number) => {
      const p = Math.min(1, (t - t0) / 900);
      setShown(Math.round(score * (1 - Math.pow(1 - p, 3))));
      if (p < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [score]);

  const R = 52;
  const C = 2 * Math.PI * R;
  return (
    <div className="relative mx-auto h-36 w-36">
      <svg viewBox="0 0 128 128" className="h-full w-full -rotate-90">
        <circle cx="64" cy="64" r={R} fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth="12" />
        {pct != null && (
          <circle
            cx="64" cy="64" r={R} fill="none"
            stroke="url(#scoreGrad)" strokeWidth="12" strokeLinecap="round"
            strokeDasharray={C} strokeDashoffset={C * (1 - pct)}
          />
        )}
        <defs>
          <linearGradient id="scoreGrad" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#89F336" />
            <stop offset="100%" stopColor="#4cc9f0" />
          </linearGradient>
        </defs>
      </svg>
      <div className="absolute inset-0 grid place-items-center">
        <div className="text-center">
          <p className="text-3xl font-black text-white">{shown}</p>
          {max != null && <p className="text-[11px] text-white/40">/ {max} pts</p>}
        </div>
      </div>
    </div>
  );
}

export default function Result({ testTitle, autoScore, maxScore, attemptId, mock, onBack, onHistory }: Props) {
  const hasScore = autoScore !== null && autoScore !== undefined;
  if (mock) {
    const multilevel = !!mock.specificationVersion;
    const band = multilevel ? mock.overallScore ?? mock.standardScores?.[mock.skill]?.estimatedStandardScore : mock.sectionBands?.[mock.skill] ?? mock.overallBand;
    return (
      <section>
        <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-brand/70">
          submitted ✓
        </p>
        <h1 className="mt-1 text-2xl font-black tracking-tight">
          {testTitle ?? "Exam submitted"}
        </h1>

        <div className="mt-4 grid items-start gap-3 xl:grid-cols-2">
          <div className="card rounded-2xl p-6 text-center">
            {band != null ? (
              <>
                <p className="text-5xl font-black text-white tabular-nums">{band.toFixed(multilevel ? 2 : 1)}</p>
                <p className="mt-2 text-sm font-semibold text-white">
                  {multilevel ? 'Estimated Multilevel Result /75' : `${MOCK_SKILL_LABEL[mock.skill]} band`}
                </p>
                {mock.cefrLevel && (
                  <p className="mt-1 text-xs text-white/40">CEFR level: {mock.cefrLevel}</p>
                )}
              </>
            ) : (
              <>
                <p className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-brand/10 text-2xl ring-1 ring-brand/30">📨</p>
                <p className="mt-3 text-sm font-semibold text-white">Submitted for grading</p>
                <p className="mt-1 text-xs text-white/40">
                  {multilevel ? 'Writing and Speaking await teacher review. Check History for your estimated scores.' : `${MOCK_SKILL_LABEL[mock.skill]} answers are with your teacher now. Check History for the final band.`}
                </p>
              </>
            )}
            {multilevel && <div className="mt-3 text-sm"><p>Estimated · unofficial</p>{Object.entries(mock.standardScores ?? {}).map(([skill, score]) => <p key={skill}>{skill}: {score.estimatedStandardScore}/75</p>)}<p className="text-xs opacity-60">{mock.specificationVersion} · {mock.scoreMethod} · {mock.scoreVersion}</p></div>}
          </div>

          <div className="card rounded-2xl p-6">
            <h2 className="text-sm font-bold text-white">What's next?</h2>
            <ul className="mt-3 space-y-2 text-xs leading-relaxed text-white/50">
              <li className="flex gap-2">
                <span className="text-brand">→</span>
                Pick another section from the exam to keep going.
              </li>
              <li className="flex gap-2">
                <span className="text-brand">→</span>
                Head back to Exams to start your next assigned test.
              </li>
            </ul>
            <div className="mt-4 grid grid-cols-2 gap-2">
              <button onClick={onBack} className="btn-brand rounded-xl px-4 py-2.5 text-sm font-bold">
                More sections
              </button>
              <button onClick={onHistory} className="btn-ghost rounded-xl px-4 py-2.5 text-sm text-white">
                View history
              </button>
            </div>
          </div>
        </div>
      </section>
    );
  }
  return (
    <section>
      <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-brand/70">
        submitted ✓
      </p>
      <h1 className="mt-1 text-2xl font-black tracking-tight">
        {testTitle ?? "Exam submitted"}
      </h1>

      <div className="mt-4 grid items-start gap-3 xl:grid-cols-2">
        <div className="card rounded-2xl p-6 text-center">
          {hasScore ? (
            <>
              <ScoreRing score={autoScore} max={maxScore ?? null} />
              <p className="mt-3 text-sm font-semibold text-white">Auto score (listening / reading)</p>
              <p className="mt-1 text-xs text-white/40">
                Writing & speaking need manual grading — the final total appears in History.
              </p>
            </>
          ) : (
            <>
              <p className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-brand/10 text-2xl ring-1 ring-brand/30">📨</p>
              <p className="mt-3 text-sm font-semibold text-white">Submitted for grading</p>
              <p className="mt-1 text-xs text-white/40">
                Writing / speaking answers are with your teacher now. Check History for the final score.
              </p>
            </>
          )}
        </div>

        <div className="card rounded-2xl p-6">
          <h2 className="text-sm font-bold text-white">What's next?</h2>
          <ul className="mt-3 space-y-2 text-xs leading-relaxed text-white/50">
            <li className="flex gap-2">
              <span className="text-brand">→</span>
              Review each answer below — find where it came from in the material.
            </li>
            <li className="flex gap-2">
              <span className="text-brand">→</span>
              Open History to track grading progress and final totals.
            </li>
            <li className="flex gap-2">
              <span className="text-brand">→</span>
              Head back to Exams to start your next assigned test.
            </li>
          </ul>
          <div className="mt-4 grid grid-cols-2 gap-2">
            <button onClick={onHistory} className="btn-brand rounded-xl px-4 py-2.5 text-sm font-bold">
              View history
            </button>
            <button onClick={onBack} className="btn-ghost rounded-xl px-4 py-2.5 text-sm text-white">
              Back to exams
            </button>
          </div>
        </div>
      </div>

      {attemptId && (
        <div className="card mt-3 rounded-2xl p-6">
          <h2 className="text-sm font-bold text-white">Answer review — locate & explain</h2>
          <p className="mt-1 text-xs text-white/40">
            Green ✓ means auto-marked correct, red ✕ means wrong. Open ⌖ Locate to see the passage lines behind each answer.
          </p>
          <div className="mt-4">
            <AttemptReview attemptId={attemptId} />
          </div>
        </div>
      )}
    </section>
  );
}
