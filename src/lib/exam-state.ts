/**
 * Unified Examination State Machine (Bestway All Devices 2.0).
 *
 * Explicitly distinguishes loading, readiness checks, active exam progress,
 * offline/reconnecting/recovering states, section transitions, submission,
 * grading, completion, and failure, preventing impossible transitions.
 */

export type ExamPhase =
  | 'loading'
  | 'readiness_check'
  | 'ready'
  | 'in_progress'
  | 'offline'
  | 'reconnecting'
  | 'recovering'
  | 'section_transition'
  | 'submitting'
  | 'submitted'
  | 'grading'
  | 'completed'
  | 'failed';

export type ExamPhaseEvent =
  | 'START_READINESS'
  | 'READY'
  | 'START_EXAM'
  | 'DISCONNECT'
  | 'RECONNECT'
  | 'RECOVER_START'
  | 'RECOVER_DONE'
  | 'SECTION_ADVANCE'
  | 'SECTION_READY'
  | 'SUBMIT_START'
  | 'SUBMIT_GRADING'
  | 'SUBMIT_COMPLETE'
  | 'SUBMIT_FAIL'
  | 'FAIL';

const TRANSITIONS: Record<ExamPhase, Partial<Record<ExamPhaseEvent, ExamPhase>>> = {
  loading: {
    START_READINESS: 'readiness_check',
    READY: 'ready',
    RECOVER_START: 'recovering',
    START_EXAM: 'in_progress',
    FAIL: 'failed',
  },
  readiness_check: {
    READY: 'ready',
    START_EXAM: 'in_progress',
    FAIL: 'failed',
  },
  ready: {
    START_EXAM: 'in_progress',
    RECOVER_START: 'recovering',
    FAIL: 'failed',
  },
  recovering: {
    RECOVER_DONE: 'in_progress',
    DISCONNECT: 'offline',
    FAIL: 'failed',
  },
  in_progress: {
    DISCONNECT: 'offline',
    RECOVER_START: 'recovering',
    SECTION_ADVANCE: 'section_transition',
    SUBMIT_START: 'submitting',
    FAIL: 'failed',
  },
  offline: {
    RECONNECT: 'reconnecting',
    RECOVER_DONE: 'in_progress',
    SUBMIT_START: 'submitting',
    FAIL: 'failed',
  },
  reconnecting: {
    RECOVER_DONE: 'in_progress',
    DISCONNECT: 'offline',
    SUBMIT_START: 'submitting',
    FAIL: 'failed',
  },
  section_transition: {
    SECTION_READY: 'in_progress',
    DISCONNECT: 'offline',
    SUBMIT_FAIL: 'in_progress',
    FAIL: 'failed',
  },
  submitting: {
    SUBMIT_GRADING: 'grading',
    SUBMIT_COMPLETE: 'completed',
    SECTION_READY: 'in_progress',
    SUBMIT_FAIL: 'in_progress',
    DISCONNECT: 'offline',
    FAIL: 'failed',
  },
  submitted: {
    SUBMIT_GRADING: 'grading',
    SUBMIT_COMPLETE: 'completed',
  },
  grading: {
    SUBMIT_COMPLETE: 'completed',
    FAIL: 'failed',
  },
  completed: {},
  failed: {
    START_READINESS: 'readiness_check',
    READY: 'ready',
    RECOVER_START: 'recovering',
  },
};

export function canTransitionExamPhase(current: ExamPhase, event: ExamPhaseEvent): boolean {
  return Boolean(TRANSITIONS[current]?.[event]);
}

export function transitionExamPhase(current: ExamPhase, event: ExamPhaseEvent): ExamPhase {
  return TRANSITIONS[current]?.[event] ?? current;
}

export function isTerminalExamPhase(phase: ExamPhase): boolean {
  return phase === 'completed';
}

export function isExamRunningPhase(phase: ExamPhase): boolean {
  return (
    phase === 'in_progress' ||
    phase === 'offline' ||
    phase === 'reconnecting' ||
    phase === 'recovering' ||
    phase === 'section_transition' ||
    phase === 'submitting'
  );
}
