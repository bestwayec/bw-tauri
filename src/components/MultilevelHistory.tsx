import { useQuery } from '@tanstack/react-query';
import { get } from '@/lib/api';

interface MultilevelAttempt { id: string; examTitle: string; status: string; overallScore: number | null; cefrLevel: string | null; specificationVersion?: string | null; scoreVersion?: string | null; standardScores?: Record<string, {estimatedStandardScore: number}> | null }
export default function MultilevelHistory({refreshKey}: {refreshKey: number}) {
  const history = useQuery({queryKey:['multilevel-history',refreshKey],queryFn:()=>get<MultilevelAttempt[]>('/mock/attempts/mine',{program:'MULTILEVEL'})});
  return <section><h1 className="text-xl font-bold">Multilevel history</h1><p className="mt-2 text-sm">Estimated practice scores · /75 · unofficial</p>
    {history.isPending && <p role="status">Loading attempts…</p>}
    {history.isError && <p role="alert">{history.error.message}</p>}
    {history.data?.length === 0 && <p className="mt-4">No Multilevel attempts yet.</p>}
    {history.data?.map((a)=><article key={a.id} className="card mt-4 rounded-xl p-4"><h2>{a.examTitle}</h2><p>{a.status} · {a.overallScore ?? '—'}/75 · {a.cefrLevel ?? 'Awaiting review'}</p>
      {Object.entries(a.standardScores ?? {}).map(([skill,score])=><p key={skill}>{skill}: {score.estimatedStandardScore}/75</p>)}
      <p className="text-xs opacity-60">{a.specificationVersion ?? 'Historical specification'} · {a.scoreVersion}</p></article>)}
  </section>;
}
