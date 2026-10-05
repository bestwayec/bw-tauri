import { useQuery, type QueryClient } from '@tanstack/react-query';
import { z } from 'zod';
import { get, patch } from './api';
import { parseOrThrow } from './schemas';
import { useSessionStore } from './session-store';

export type ExamProgram = 'IELTS' | 'MULTILEVEL';
export const PRACTICE_LEVELS = ['A1', 'A2', 'B1', 'B2', 'C1'] as const;
export type PracticeLevel = typeof PRACTICE_LEVELS[number];

export const programStateSchema = z.object({
  availablePrograms: z.array(z.enum(['IELTS', 'MULTILEVEL'])),
  activeProgram: z.enum(['IELTS', 'MULTILEVEL']).nullable(),
  accessPolicy: z.enum(['SELF_SELECT', 'STAFF_ASSIGNED']).optional(),
});
export type ProgramState = z.infer<typeof programStateSchema>;

export function programQueryKey(resource: string, userId: string | null | undefined, program: ExamProgram | null | undefined) {
  return [resource, userId ?? null, program ?? null] as const;
}

const PROGRAM_DATA = new Set(['tests', 'my-attempts', 'mock-exams', 'mock-assessment-history', 'assessment']);
export function isProgramDataKey(key: readonly unknown[]) {
  return typeof key[0] === 'string' && PROGRAM_DATA.has(key[0]);
}

export async function getPrograms(): Promise<ProgramState> {
  return parseOrThrow('Exam programs', programStateSchema, await get<unknown>('/exam-programs/mine'));
}

export async function selectProgram(program: ExamProgram): Promise<ProgramState> {
  return parseOrThrow('Exam program selection', programStateSchema, await patch<unknown>('/exam-programs/mine', { program }));
}

export async function refreshProgramContext(client: QueryClient, userId: string | null | undefined, data: ProgramState, revalidateProfile: () => Promise<void>) {
  await client.cancelQueries({ predicate: (query) => isProgramDataKey(query.queryKey) });
  client.setQueryData(['exam-programs', userId ?? null], data);
  client.removeQueries({ predicate: (query) => isProgramDataKey(query.queryKey) });
  await Promise.all([
    // New program keys fetch on mount; do not launch another request for the old track.
    client.invalidateQueries({ predicate: (query) => isProgramDataKey(query.queryKey), refetchType: 'none' }),
    revalidateProfile(),
  ]);
}

export function usePrograms() {
  const userId = useSessionStore((state) => state.profile?.id);
  const ready = useSessionStore((state) => state.status === 'ready');
  return useQuery({ queryKey: ['exam-programs', userId ?? null], queryFn: getPrograms, enabled: ready && !!userId });
}

export function belongsToProgram(type: string | null | undefined, program: ExamProgram) {
  return program === 'MULTILEVEL' ? type === 'multilevel' : type === 'ielts' || type === 'ielts_academic' || type === 'ielts_general';
}

export function formatIeltsBand(value: number | null | undefined) {
  return value == null ? 'Pending' : value.toFixed(1);
}
