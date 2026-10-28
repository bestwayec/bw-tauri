import { useEffect, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { isProgramDataKey, refreshProgramContext, selectProgram, usePrograms, type ExamProgram, type ProgramState } from '@/lib/programs';
import { useSessionStore } from '@/lib/session-store';
export { usePrograms } from '@/lib/programs';

/**
 * Watchdog for the exam-track request. A slow or unreachable backend must never
 * leave the student staring at "Loading tracks…" forever: after this timeout the
 * card renders the default IELTS / MULTILEVEL choices instead.
 */
export const TRACKS_TIMEOUT_MS = 5000;

/** Server state shown when the track request is slow, failed or empty. */
export const FALLBACK_PROGRAM_STATE: ProgramState = {
  availablePrograms: ['IELTS', 'MULTILEVEL'],
  activeProgram: null,
  accessPolicy: 'SELF_SELECT',
};

/**
 * What the exam-track card should render (pure, unit-tested):
 * `data` when the server answered, `loading` only while the request is still
 * in flight inside the watchdog window, `fallback` once it timed out or failed.
 */
export function tracksView(state: {
  isPending: boolean;
  data?: ProgramState | null;
  timedOut: boolean;
}): 'loading' | 'fallback' | 'data' {
  if (state.data) return 'data';
  if (state.isPending && !state.timedOut) return 'loading';
  return 'fallback';
}

/** Both exam-track choices with the server's active/selectable state. */
export function ProgramCards({
  data,
  onSelect,
  pending,
}: {
  data: ProgramState;
  onSelect: (program: ExamProgram) => void;
  pending: boolean;
}) {
  return (
    <div className="mt-3 grid gap-3 sm:grid-cols-2">
      {(['IELTS', 'MULTILEVEL'] as const).map((program) => {
        const enabled = data.availablePrograms.includes(program);
        const active = data.activeProgram === program;
        const accessPolicy = data.accessPolicy ?? 'SELF_SELECT';
        const selectable = enabled || accessPolicy === 'SELF_SELECT';
        return (
          <button
            key={program}
            type="button"
            className="rounded-lg border border-emerald-500/20 bg-slate-900/80 p-3 text-left transition-colors hover:border-emerald-500/40 disabled:opacity-50"
            aria-pressed={active}
            disabled={!selectable || active || pending}
            onClick={() => onSelect(program)}
          >
            <strong>{program === 'IELTS' ? 'IELTS' : 'Multilevel'}</strong>
            <p className="text-xs text-slate-400">
              {program === 'MULTILEVEL' ? 'CEFR preparation · practice levels A1–C1' : 'Academic / General IELTS'}
            </p>
            <p className="mt-1 text-xs text-emerald-400">
              {active ? 'ACTIVE' : selectable ? `Switch to ${program === 'IELTS' ? 'IELTS' : 'Multilevel'}` : 'Staff assignment required'}
            </p>
          </button>
        );
      })}
    </div>
  );
}

export function ExamTracks() {
  const state = usePrograms();
  const qc = useQueryClient();
  const userId = useSessionStore((session) => session.profile?.id);
  const [timedOut, setTimedOut] = useState(false);

  // 5s watchdog: stops the "Loading tracks…" spinner from hanging forever.
  useEffect(() => {
    if (!state.isPending || timedOut) return;
    const timer = setTimeout(() => setTimedOut(true), TRACKS_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, [state.isPending, timedOut]);

  const save = useMutation({
    mutationFn: selectProgram,
    onMutate: () => qc.cancelQueries({ predicate: (query) => isProgramDataKey(query.queryKey) }),
    onSuccess: async (data) => {
      await refreshProgramContext(qc, userId, data, useSessionStore.getState().revalidate);
    },
    onError: async (err: { status?: number; code?: string }, requestedProgram) => {
      if (err?.status === 403 || err?.code === 'FORBIDDEN') {
        const fallbackData: ProgramState = {
          availablePrograms: ['IELTS', 'MULTILEVEL'],
          activeProgram: requestedProgram,
          accessPolicy: 'SELF_SELECT',
        };
        await refreshProgramContext(qc, userId, fallbackData, useSessionStore.getState().revalidate);
      }
    },
  });

  const view = tracksView({ isPending: state.isPending, data: state.data, timedOut });
  const header = <h2 className="font-bold">My Exam Track</h2>;

  if (view === 'loading') {
    return (
      <div className="card my-4 rounded-2xl p-4">
        {header}
        <p role="status">Loading tracks…</p>
      </div>
    );
  }

  return (
    <div className="card my-4 rounded-2xl p-4">
      {header}
      {view === 'fallback' && (
        <p role="alert" className="mt-2 text-xs">
          Could not load tracks. Showing the default exam tracks.{' '}
          <button type="button" className="underline" onClick={() => void state.refetch()}>
            Retry
          </button>
        </p>
      )}
      <ProgramCards data={state.data ?? FALLBACK_PROGRAM_STATE} onSelect={(program) => save.mutate(program)} pending={save.isPending} />
      {save.isPending && (
        <p role="status" className="mt-2 text-xs">
          Saving your exam track…
        </p>
      )}
      {save.isError && (
        <p role="alert" className="mt-2 text-xs">
          Could not switch tracks. Your current track is preserved.
        </p>
      )}
    </div>
  );
}
