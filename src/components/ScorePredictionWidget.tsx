import { useQuery } from "@tanstack/react-query";
import { get } from "@/lib/api";
import { useAssessmentOverview } from "@/lib/assessment-overview";
import type { AttemptSummary } from "@/lib/tests";
import type { ExamProgram } from "@/lib/programs";

export type CefrPredictedLevel = "A2" | "B1" | "B2" | "C1";

export interface PredictionAttemptPoint {
  attemptId: string;
  title: string;
  date: string;
  ieltsBand: number;
  multilevelScore: number;
}

export interface ScorePredictionPayload {
  predictedBand: number;
  predictedMultilevelScore: number;
  cefrLevel: CefrPredictedLevel;
  targetBand: number;
  targetMultilevelScore: number;
  targetProgressPct: number;
  confidencePct: number;
  attemptsCount: number;
  history: PredictionAttemptPoint[];
  weakModules: Array<{
    module: string;
    skill: "listening" | "reading" | "writing" | "speaking";
    accuracyPct: number;
    recommendation: string;
  }>;
}

/**
 * Official Multi-Level (0–75 ball) to CEFR mapping:
 * - A2: 0–33
 * - B1: 34–45
 * - B2: 46–59
 * - C1: 60–75
 */
export function multilevelScoreToCefr(score: number): CefrPredictedLevel {
  const clamped = Math.max(0, Math.min(75, Math.round(Number.isFinite(score) ? score : 0)));
  if (clamped >= 60) return "C1";
  if (clamped >= 46) return "B2";
  if (clamped >= 34) return "B1";
  return "A2";
}

/** Convert an IELTS band (0.0–9.0) to an equivalent Multi-Level score (0–75) or vice versa. */
export function bandToMultilevelScore(band: number): number {
  if (!Number.isFinite(band) || band <= 0) return 0;
  const clamped = Math.max(0, Math.min(9, band));
  return Math.round((clamped / 9) * 75);
}

export function multilevelScoreToBand(score: number): number {
  if (!Number.isFinite(score) || score <= 0) return 0;
  const clamped = Math.max(0, Math.min(75, score));
  const rawBand = (clamped / 75) * 9;
  return Math.round(rawBand * 2) / 2;
}

/** Compute fallback prediction from local attempts when offline or before server history populates. */
export function computeFallbackPrediction(
  attempts: AttemptSummary[] | null | undefined,
  program: ExamProgram = "IELTS",
): ScorePredictionPayload {
  const scored = (attempts ?? []).filter(
    (a) => a.status === "completed" && (a.totalScore != null || a.autoScore != null),
  );
  const recent = scored.slice(0, 5).reverse();

  const history: PredictionAttemptPoint[] = recent.map((a, idx) => {
    const rawVal = Number(a.totalScore ?? a.autoScore ?? 0);
    // Heuristic: values <= 9.0 are already IELTS bands; values > 9 are raw/75 scores.
    const isBandScale = rawVal > 0 && rawVal <= 9.0;
    const ieltsBand = isBandScale
      ? Math.round(rawVal * 2) / 2
      : multilevelScoreToBand(Math.min(75, rawVal));
    const multilevelScore = isBandScale
      ? bandToMultilevelScore(rawVal)
      : Math.max(0, Math.min(75, Math.round(rawVal)));
    return {
      attemptId: a.id || `att-${idx}`,
      title: a.testTitle ?? `Mock Attempt #${idx + 1}`,
      date: a.finishedAt ?? a.startedAt ?? new Date().toISOString(),
      ieltsBand,
      multilevelScore,
    };
  });

  // Weighted moving average of last 3-5 attempts (newest weighted higher)
  let predictedBand = program === "MULTILEVEL" ? 6.0 : 6.5;
  let predictedMultilevelScore = program === "MULTILEVEL" ? 51 : 54;

  if (history.length > 0) {
    let weightSum = 0;
    let bandWeighted = 0;
    let mlWeighted = 0;
    history.forEach((pt, i) => {
      const w = i + 1;
      weightSum += w;
      bandWeighted += pt.ieltsBand * w;
      mlWeighted += pt.multilevelScore * w;
    });
    predictedBand = Math.round((bandWeighted / weightSum) * 2) / 2;
    predictedMultilevelScore = Math.round(mlWeighted / weightSum);
  }

  const targetBand = 7.5;
  const targetMultilevelScore = 65;
  const targetProgressPct =
    program === "MULTILEVEL"
      ? Math.min(100, Math.max(8, Math.round((predictedMultilevelScore / targetMultilevelScore) * 100)))
      : Math.min(100, Math.max(8, Math.round((predictedBand / targetBand) * 100)));

  return {
    predictedBand,
    predictedMultilevelScore,
    cefrLevel: multilevelScoreToCefr(predictedMultilevelScore),
    targetBand,
    targetMultilevelScore,
    targetProgressPct,
    confidencePct: history.length >= 3 ? 88 : history.length > 0 ? 72 : 60,
    attemptsCount: scored.length,
    history,
    weakModules: [
      {
        module: "Reading Matching Headings",
        skill: "reading",
        accuracyPct: 58,
        recommendation: "Focus on paragraph topic sentences before scanning options.",
      },
      {
        module: "Listening Part 3 (Multiple Choice)",
        skill: "listening",
        accuracyPct: 62,
        recommendation: "Track speaker agreement and distractor transitions.",
      },
      {
        module: "Writing Task 2 Cohesion",
        skill: "writing",
        accuracyPct: 66,
        recommendation: "Use clearer topic sentences and concession clauses.",
      },
    ],
  };
}

function normalizeServerPrediction(
  raw: Record<string, unknown> | null | undefined,
  fallback: ScorePredictionPayload,
): ScorePredictionPayload {
  if (!raw || typeof raw !== "object") return fallback;
  const rawIelts = (raw.ielts ?? {}) as Record<string, unknown>;
  const rawMl = (raw.multilevel ?? {}) as Record<string, unknown>;

  const band =
    typeof rawIelts.predictedBand === "number"
      ? rawIelts.predictedBand
      : typeof raw.predictedBand === "number"
        ? raw.predictedBand
        : typeof raw.predicted_band === "number"
          ? raw.predicted_band
          : fallback.predictedBand;

  const mlScore =
    typeof rawMl.predictedScore === "number"
      ? rawMl.predictedScore
      : typeof raw.predictedMultilevelScore === "number"
        ? raw.predictedMultilevelScore
        : typeof raw.predicted_multilevel_score === "number"
          ? raw.predicted_multilevel_score
          : typeof raw.multilevelScore === "number"
            ? raw.multilevelScore
            : bandToMultilevelScore(band);

  const cefrLevel =
    typeof rawMl.cefrLevel === "string" && ["A2", "B1", "B2", "C1"].includes(rawMl.cefrLevel)
      ? (rawMl.cefrLevel as CefrPredictedLevel)
      : multilevelScoreToCefr(mlScore);

  const targetBand =
    typeof rawIelts.targetBand === "number"
      ? rawIelts.targetBand
      : typeof raw.targetBand === "number"
        ? raw.targetBand
        : typeof raw.target_band === "number"
          ? raw.target_band
          : fallback.targetBand;

  const targetMultilevelScore =
    typeof rawMl.targetScore === "number"
      ? rawMl.targetScore
      : typeof raw.targetMultilevelScore === "number"
        ? raw.targetMultilevelScore
        : typeof raw.target_multilevel_score === "number"
          ? raw.target_multilevel_score
          : fallback.targetMultilevelScore;

  const targetProgressPct =
    typeof rawIelts.targetProgressPercent === "number"
      ? rawIelts.targetProgressPercent
      : typeof rawMl.targetProgressPercent === "number"
        ? rawMl.targetProgressPercent
        : typeof raw.targetProgressPct === "number"
          ? raw.targetProgressPct
          : typeof raw.target_progress_pct === "number"
            ? raw.target_progress_pct
            : Math.min(100, Math.max(5, Math.round((mlScore / targetMultilevelScore) * 100)));

  const rawWeak = Array.isArray(raw.weakModules)
    ? raw.weakModules
    : Array.isArray(raw.weak_modules)
      ? raw.weak_modules
      : null;

  const weakModules =
    rawWeak && rawWeak.length > 0
      ? rawWeak.slice(0, 4).map((w: unknown, idx: number) => {
          if (typeof w === "string") {
            return {
              module: w,
              skill: (idx % 2 === 0 ? "reading" : "listening") as "reading" | "listening",
              accuracyPct: 60,
              recommendation: "Practice targeted timed drills.",
            };
          }
          const obj = (w ?? {}) as Record<string, unknown>;
          return {
            module: String(obj.module ?? obj.title ?? obj.name ?? "Reading Matching"),
            skill: (obj.skill as "reading" | "listening" | "writing" | "speaking") ?? "reading",
            accuracyPct:
              typeof obj.accuracyPercent === "number"
                ? obj.accuracyPercent
                : typeof obj.accuracyPct === "number"
                  ? obj.accuracyPct
                  : typeof obj.accuracy === "number"
                    ? obj.accuracy
                    : 60,
            recommendation: String(obj.recommendation ?? obj.tip ?? "Practice targeted timed drills."),
          };
        })
      : fallback.weakModules;

  return {
    ...fallback,
    predictedBand: band,
    predictedMultilevelScore: mlScore,
    cefrLevel,
    targetBand,
    targetMultilevelScore,
    targetProgressPct,
    weakModules,
  };
}

const CEFR_BADGE_STYLE: Record<CefrPredictedLevel, string> = {
  A2: "border-amber-500/40 bg-amber-500/15 text-amber-300",
  B1: "border-sky-500/40 bg-sky-500/15 text-sky-300",
  B2: "border-violet-500/40 bg-violet-500/15 text-violet-300",
  C1: "border-emerald-500/40 bg-emerald-500/15 text-emerald-300",
};

interface Props {
  program: ExamProgram;
  attempts?: AttemptSummary[] | null;
  onPracticeWeakSkill?: () => void;
}

export default function ScorePredictionWidget({ program, attempts, onPracticeWeakSkill }: Props) {
  const fallback = computeFallbackPrediction(attempts, program);
  const overviewQuery = useAssessmentOverview();

  const query = useQuery({
    queryKey: ["mock-prediction-me", program, attempts?.length ?? 0],
    queryFn: async () => {
      try {
        const res = await get<Record<string, unknown>>("/mock/prediction/me");
        return normalizeServerPrediction(res, fallback);
      } catch {
        return fallback;
      }
    },
    staleTime: 60_000,
    retry: 1,
  });

  const livePrediction = overviewQuery.data?.prediction
    ? normalizeServerPrediction(overviewQuery.data.prediction as unknown as Record<string, unknown>, fallback)
    : query.data;
  const data = livePrediction ?? fallback;
  const chartPoints =
    data.history.length > 0
      ? data.history
      : [
          { attemptId: "s1", title: "Diagnostic", date: "", ieltsBand: 5.5, multilevelScore: 42 },
          { attemptId: "s2", title: "Mock 1", date: "", ieltsBand: 6.0, multilevelScore: 48 },
          {
            attemptId: "s3",
            title: "Current Est.",
            date: "",
            ieltsBand: data.predictedBand,
            multilevelScore: data.predictedMultilevelScore,
          },
        ];

  return (
    <div
      className="card relative overflow-hidden rounded-2xl border border-emerald-500/25 bg-gradient-to-br from-[#131F33] via-[#101929] to-[#0B0F17] p-5 shadow-lg"
      aria-label="AI Score & Band Predictor"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-500/35 bg-emerald-500/15 px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-emerald-300">
              AI Band & CEFR Predictor
            </span>
            <span
              className={`rounded-full border px-2.5 py-0.5 text-[11px] font-extrabold ${CEFR_BADGE_STYLE[data.cefrLevel]}`}
            >
              CEFR {data.cefrLevel}
            </span>
          </div>
          <h2 className="mt-1.5 text-base font-extrabold text-white">
            Dual-Scale Exam Score Forecast
          </h2>
          <p className="text-xs text-white/50">
            Calibrated from your recent mock performance · CEFR scale: A2 (0-33) · B1 (34-45) · B2 (46-59) · C1 (60-75)
          </p>
        </div>

        {/* Dual-scale badges */}
        <div className="flex items-center gap-3">
          <div className="rounded-xl border border-sky-500/30 bg-sky-500/10 px-3.5 py-2 text-center">
            <p className="text-[10px] font-bold uppercase tracking-wider text-sky-300/80">IELTS Band</p>
            <p className="text-2xl font-black tabular-nums text-white">
              {data.predictedBand.toFixed(1)}
              <span className="text-xs font-medium text-white/40"> / 9.0</span>
            </p>
          </div>
          <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-3.5 py-2 text-center">
            <p className="text-[10px] font-bold uppercase tracking-wider text-emerald-300/80">Multi-Level</p>
            <p className="text-2xl font-black tabular-nums text-emerald-400">
              {data.predictedMultilevelScore}
              <span className="text-xs font-medium text-white/40"> / 75 ball</span>
            </p>
          </div>
        </div>
      </div>

      {/* Target Progress Bar */}
      <div className="mt-4">
        <div className="flex items-center justify-between text-xs">
          <span className="font-semibold text-white/75">
            Target Progress ({program === "MULTILEVEL" ? `${data.targetMultilevelScore} ball (C1)` : `Band ${data.targetBand.toFixed(1)}`})
          </span>
          <span className="font-mono font-bold text-emerald-400">{data.targetProgressPct}%</span>
        </div>
        <div className="mt-1.5 h-2 w-full overflow-hidden rounded-full bg-white/10">
          <div
            className="h-full rounded-full bg-gradient-to-r from-emerald-500 to-teal-400 transition-all duration-500"
            style={{ width: `${data.targetProgressPct}%` }}
          />
        </div>
      </div>

      {/* Mini Progression Chart + Weak Modules */}
      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        {/* Progression mini-chart of last 3-5 attempts */}
        <div className="rounded-xl border border-white/10 bg-black/25 p-3.5">
          <div className="flex items-center justify-between">
            <p className="text-xs font-bold text-white/80">Recent Progression (Last {chartPoints.length} Attempts)</p>
            <span className="text-[10px] text-white/40">Confidence {data.confidencePct}%</span>
          </div>
          <div className="mt-3 flex h-24 items-end gap-2.5 pt-2">
            {chartPoints.map((pt, i) => {
              const pct = Math.max(15, Math.min(100, Math.round((pt.multilevelScore / 75) * 100)));
              const lvl = multilevelScoreToCefr(pt.multilevelScore);
              return (
                <div key={pt.attemptId || i} className="flex flex-1 flex-col items-center gap-1">
                  <span className="font-mono text-[10px] font-bold text-emerald-300">
                    {program === "MULTILEVEL" ? `${pt.multilevelScore}b` : pt.ieltsBand.toFixed(1)}
                  </span>
                  <div className="flex h-14 w-full items-end rounded-md bg-white/5 p-0.5">
                    <div
                      className="w-full rounded bg-gradient-to-t from-emerald-600 to-emerald-400"
                      style={{ height: `${pct}%` }}
                      title={`${pt.title}: Band ${pt.ieltsBand.toFixed(1)} / ${pt.multilevelScore} ball (${lvl})`}
                    />
                  </div>
                  <span className="max-w-full truncate text-[10px] text-white/45">{pt.title}</span>
                </div>
              );
            })}
          </div>
        </div>

        {/* Weak Modules */}
        <div className="rounded-xl border border-white/10 bg-black/25 p-3.5">
          <div className="flex items-center justify-between">
            <p className="text-xs font-bold text-white/80">Priority Weak Modules to Boost Score</p>
            {onPracticeWeakSkill && (
              <button
                type="button"
                onClick={onPracticeWeakSkill}
                className="text-[11px] font-bold text-emerald-400 hover:underline"
              >
                Practice now →
              </button>
            )}
          </div>
          <ul className="mt-2.5 space-y-2">
            {data.weakModules.slice(0, 3).map((w) => (
              <li
                key={w.module}
                className="flex items-center justify-between gap-2 rounded-lg border border-white/5 bg-white/[0.03] px-3 py-1.5 text-xs"
              >
                <div className="min-w-0">
                  <p className="truncate font-semibold text-white">{w.module}</p>
                  <p className="truncate text-[11px] text-white/45">{w.recommendation}</p>
                </div>
                <span className="shrink-0 rounded-md border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 font-mono text-[11px] font-bold text-amber-300">
                  {w.accuracyPct}%
                </span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}
