import { useQuery } from "@tanstack/react-query";
import { get } from "./api";

export type CefrLevel = "A2" | "B1" | "B2" | "C1";

export interface WeakModule {
  module: string;
  skill: "listening" | "reading" | "writing" | "speaking" | string;
  questionType?: string;
  questionTypeLabel?: string;
  parts?: string[];
  totalQuestions?: number;
  correctCount?: number;
  errorCount?: number;
  accuracyPercent?: number;
  accuracyPct?: number;
  errorRatePercent?: number;
  severity?: "high" | "medium" | "low";
  recommendation: string;
}

export interface DualScaleIelts {
  currentBand: number;
  predictedBand: number;
  trendDelta: number;
  targetBand: number;
  targetProgressPercent: number;
  gapToTarget: number;
  cefrLevel: string;
  skillBreakdown?: Record<string, number>;
}

export interface DualScaleMultilevel {
  currentScore: number;
  predictedScore: number;
  trendDelta: number;
  targetScore: number;
  targetCefr: string;
  targetProgressPercent: number;
  gapToTarget: number;
  cefrLevel: string;
  scaleBands?: Array<{ level: string; min: number; max: number; label: string }>;
  skillBreakdown?: Record<string, number>;
}

export interface PredictionHistoryPoint {
  attemptId: string;
  examId?: string;
  examTitle: string;
  examType?: string;
  date: string;
  rawScore?: number;
  rawMax?: number;
  ieltsBand: number;
  multilevelScore: number;
  cefrLevel: string;
  skills?: Record<string, number>;
  skillsMultilevel?: Record<string, number>;
}

export interface StudentPrediction {
  studentId: string;
  studentName?: string | null;
  activeProgram?: string;
  attemptsAnalyzed: number;
  trend: "improving" | "stable" | "declining" | "insufficient_data";
  ielts: DualScaleIelts;
  multilevel: DualScaleMultilevel;
  history?: PredictionHistoryPoint[];
  weakModules: WeakModule[];
}

export interface AssessmentOverviewData {
  user: {
    id: string;
    name?: string | null;
    phone?: string | null;
    role?: string;
  };
  prediction: StudentPrediction;
  recentAttempts?: Array<{
    id: string;
    examId?: string;
    examTitle?: string;
    type?: string;
    status?: string;
    overallBand?: number;
    overallScore?: number;
    startedAt?: string;
    finishedAt?: string;
    [key: string]: unknown;
  }>;
  writingAssessments?: Array<unknown>;
  speakingAssessments?: Array<unknown>;
  statistics?: {
    totalAttempts?: number;
    averageIeltsBand?: number;
    averageMultilevelScore?: number;
    bestIeltsBand?: number;
    bestMultilevelScore?: number;
    [key: string]: unknown;
  };
}

export function multilevelScoreToCefr(score: number): CefrLevel {
  const clamped = Math.max(0, Math.min(75, Math.round(Number.isFinite(score) ? score : 0)));
  if (clamped >= 60) return "C1";
  if (clamped >= 46) return "B2";
  if (clamped >= 34) return "B1";
  return "A2";
}

export async function fetchAssessmentOverview(): Promise<AssessmentOverviewData> {
  return get<AssessmentOverviewData>("/assessment/overview");
}

export function useAssessmentOverview(options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: ["assessment-overview"],
    queryFn: fetchAssessmentOverview,
    staleTime: 30_000,
    retry: 2,
    enabled: options?.enabled ?? true,
  });
}
