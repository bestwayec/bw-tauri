import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { get, patch } from '@/lib/api';
import { z } from 'zod';
import { parseOrThrow } from '@/lib/schemas';
const programState = z.object({ availablePrograms: z.array(z.enum(['IELTS','MULTILEVEL'])), activeProgram: z.enum(['IELTS','MULTILEVEL']).nullable() });
export function usePrograms() { return useQuery({ queryKey: ['exam-programs'], queryFn: async () => parseOrThrow('exam programs', programState, await get<unknown>('/exam-programs/mine')) }); }
export function ExamTracks() {
  const state = usePrograms(); const qc = useQueryClient();
  const save = useMutation({ mutationFn: (program: 'IELTS' | 'MULTILEVEL') => patch('/exam-programs/mine', { program }), onSuccess: () => qc.invalidateQueries({ queryKey: ['exam-programs'] }) });
  return <div className="card my-4 rounded-2xl p-4"><h2 className="font-bold">My Exam Track</h2>
    {state.isPending ? <p role="status">Loading tracks…</p> : state.data ? <div className="mt-3 grid gap-3 sm:grid-cols-2">{(['IELTS','MULTILEVEL'] as const).map((program) => {
      const enabled = state.data.availablePrograms.includes(program);
      return <button key={program} type="button" className="rounded-lg border border-white/20 p-3 text-left disabled:opacity-50" aria-pressed={state.data.activeProgram === program} disabled={!enabled || save.isPending} onClick={() => save.mutate(program)}>
        <strong>{program}</strong><p className="text-xs">{program === 'MULTILEVEL' ? 'Uzbekistan CEFR B1/B2/C1' : 'Academic / General IELTS'}</p>
        <p className="text-xs">{enabled ? state.data.activeProgram === program ? 'Active track' : 'Enrolled' : 'Locked — not enrolled'}</p>
      </button>;
    })}</div> : <p role="alert">Could not load tracks.</p>}
    {save.isError && <p role="alert">Could not switch tracks.</p>}
  </div>;
}
