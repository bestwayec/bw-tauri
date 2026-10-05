import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { z } from 'zod';
import { get } from '@/lib/api';
import { parseOrThrow } from '@/lib/schemas';
import AssessmentFeedback from './AssessmentFeedback';
import { belongsToProgram, formatIeltsBand, programQueryKey } from '@/lib/programs';
import { useSessionStore } from '@/lib/session-store';

const historySchema = z.array(z.object({
  id: z.string(), examTitle: z.string(), examType: z.enum(['ielts_academic', 'ielts_general', 'multilevel']),
  status: z.enum(['in_progress', 'grading', 'completed']), startedAt: z.string(),
  overallBand: z.number().nullable(), sectionBands: z.record(z.string(), z.number()).nullable(),
  cefrLevel: z.string().nullable(), overallScore: z.number().nullable().optional(), specificationVersion: z.string().nullable().optional(),
  scoreVersion: z.string().nullable().optional(), standardScores: z.record(z.string(), z.object({ estimatedStandardScore: z.number() })).nullable().optional(),
}));
export async function getMockHistory(program: 'IELTS' | 'MULTILEVEL') {
  return parseOrThrow('Mock history', historySchema, await get<unknown>('/mock/attempts/mine', { program, limit: 50 }));
}

export default function MockAssessmentHistory({ program, refreshKey }: { program: 'IELTS' | 'MULTILEVEL'; refreshKey: number }) {
  const [expanded, setExpanded] = useState<string | null>(null);
  const userId = useSessionStore((state) => state.profile?.id);
  const history = useQuery({ queryKey: [...programQueryKey('mock-assessment-history', userId, program), refreshKey], queryFn: () => getMockHistory(program), retry: false, enabled: !!userId });
  return <section aria-label={`${program} mock history`}>
    <div className="flex items-center justify-between gap-3"><h2 className="text-lg font-bold">{program === 'MULTILEVEL' ? 'Multilevel history' : 'IELTS mock exams and feedback'}</h2><button type="button" disabled={history.isFetching} className="btn-ghost rounded-lg px-3 py-2 text-xs" onClick={() => void history.refetch()}>Refresh</button></div>
    <p className="mt-1 text-xs text-white/50">Estimated practice results · unofficial · Writing and Speaking may await assessment or teacher review.</p>
    {history.isPending && <p role="status" className="mt-3">Loading attempts…</p>}
    {history.isError && <p role="alert" className="mt-3 text-sm text-amber-200">Could not load mock history. Use Refresh to retry.</p>}
    {history.data?.length === 0 && <p className="mt-3 text-sm text-white/50">No {program} mock attempts yet.</p>}
    {history.data?.filter((attempt) => belongsToProgram(attempt.examType, program)).map((attempt) => {
      const multilevel = attempt.examType === 'multilevel';
      return <article key={attempt.id} className="card mt-4 rounded-xl p-4">
        <h3 className="font-bold">{attempt.examTitle}</h3><p className="mt-1 text-sm text-white/60">{attempt.status === 'grading' ? 'Submitted · assessment / teacher review pending' : attempt.status.replace('_', ' ')}</p>
        <p className="mt-2 text-sm">{multilevel ? `Estimated Multilevel result: ${attempt.overallScore ?? 'Pending'} /75` : `Estimated IELTS overall band: ${formatIeltsBand(attempt.overallBand)}`}{multilevel && attempt.cefrLevel ? ` · ${attempt.cefrLevel === 'BELOW_B1' ? 'Below B1' : attempt.cefrLevel}` : ''}</p>
        {Object.entries(multilevel ? attempt.standardScores ?? {} : attempt.sectionBands ?? {}).map(([skill, value]) => <p key={skill} className="mt-1 text-sm text-white/60">{skill}: {typeof value === 'number' ? formatIeltsBand(value) : value.estimatedStandardScore}{multilevel ? '/75' : ' band'}</p>)}
        {attempt.status !== 'in_progress' && <button type="button" className="btn-ghost mt-3 rounded-lg px-3 py-2 text-sm" aria-expanded={expanded === attempt.id} onClick={() => setExpanded(expanded === attempt.id ? null : attempt.id)}>{expanded === attempt.id ? 'Hide feedback' : 'View Writing / Speaking feedback'}</button>}
        {expanded === attempt.id && <AssessmentFeedback key={attempt.id} attemptId={attempt.id} />}
        {multilevel && <p className="mt-3 text-xs text-white/35">{attempt.specificationVersion ?? 'Historical specification'} · {attempt.scoreVersion}</p>}
      </article>;
    })}
  </section>;
}
