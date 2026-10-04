import { useMutation, useQueryClient } from '@tanstack/react-query';
import { isProgramDataKey, refreshProgramContext, selectProgram, usePrograms } from '@/lib/programs';
import { useSessionStore } from '@/lib/session-store';
export { usePrograms } from '@/lib/programs';
export function ExamTracks() {
  const state = usePrograms(); const qc = useQueryClient();
  const userId = useSessionStore((session) => session.profile?.id);
  const save = useMutation({ mutationFn: selectProgram,
    onMutate: () => qc.cancelQueries({ predicate: (query) => isProgramDataKey(query.queryKey) }),
    onSuccess: async (data) => {
    await refreshProgramContext(qc, userId, data, useSessionStore.getState().revalidate);
  } });
  return <div className="card my-4 rounded-2xl p-4"><h2 className="font-bold">My Exam Track</h2>
    {state.isPending ? <p role="status">Loading tracks…</p> : state.data ? <div className="mt-3 grid gap-3 sm:grid-cols-2">{(['IELTS','MULTILEVEL'] as const).map((program) => {
      const enabled = state.data.availablePrograms.includes(program);
      const active = state.data.activeProgram === program;
      const accessPolicy = state.data.accessPolicy ?? 'SELF_SELECT';
      const selectable = enabled || accessPolicy === 'SELF_SELECT';
      return <button key={program} type="button" className="rounded-lg border border-white/20 p-3 text-left disabled:opacity-50" aria-pressed={active} disabled={!selectable || active || save.isPending} onClick={() => save.mutate(program)}>
        <strong>{program === 'IELTS' ? 'IELTS' : 'Multilevel'}</strong><p className="text-xs">{program === 'MULTILEVEL' ? 'CEFR preparation · practice levels A1–C1' : 'Academic / General IELTS'}</p>
        <p className="mt-1 text-xs">{active ? 'ACTIVE' : selectable ? `Switch to ${program === 'IELTS' ? 'IELTS' : 'Multilevel'}` : 'Staff assignment required'}</p>
      </button>;
    })}</div> : <p role="alert">Could not load tracks. <button className="underline" onClick={() => void state.refetch()}>Retry</button></p>}
    {save.isPending && <p role="status" className="mt-2 text-xs">Saving your exam track…</p>}
    {save.isError && <p role="alert" className="mt-2 text-xs">Could not switch tracks. Your current track is preserved.</p>}
  </div>;
}
