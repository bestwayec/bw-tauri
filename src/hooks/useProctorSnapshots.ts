import { useEffect, useRef, useState } from "react";
import { reportCheat, type CheatKind, type CheatScope } from "@/lib/cheat";
import {
  appendSecurityLog,
  captureWebcamSnapshot,
  cheatKindFor,
  nextSnapshotDelay,
  proctorSupported,
  snapshotDetail,
  type SecurityLogEntry,
} from "@/lib/proctoring";

/**
 * Background integrity snapshots during an exam.
 *
 * One timer is armed at a time, 10-15 minutes apart (uniform), and each shot
 * opens the camera for a single frame and releases it again — no stream is
 * left running between snapshots, and cleanup stops everything on unmount or
 * when the exam goes inactive.
 *
 * Failures are silent: they are recorded locally as `webcam_blocked` and never
 * interrupt the attempt.
 */
export interface ProctorSnapshotLoopOptions {
  attemptId: string;
  /** Injected for deterministic tests. Defaults to Math.random. */
  random?: () => number;
  onEvent?: (entry: SecurityLogEntry) => void;
  capture?: typeof captureWebcamSnapshot;
  log?: typeof appendSecurityLog;
  report?: (attemptId: string, kind: CheatKind, scope: CheatScope) => Promise<void>;
  schedule?: (run: () => void, ms: number) => number;
  cancel?: (id: number) => void;
}

function messageOf(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  return "The camera snapshot could not be taken.";
}

/**
 * Plain (React-free) scheduler so the timing/retry contract is unit-testable
 * with fake timers. Returns a `stop()` that cancels the pending timer.
 */
export function startProctorSnapshotLoop(opts: ProctorSnapshotLoopOptions): () => void {
  const schedule = opts.schedule ?? ((run: () => void, ms: number) => window.setTimeout(run, ms));
  const cancel = opts.cancel ?? ((id: number) => window.clearTimeout(id));
  const capture = opts.capture ?? captureWebcamSnapshot;
  const log = opts.log ?? appendSecurityLog;
  const report = opts.report ?? reportCheat;

  let stopped = false;
  let timer: number | null = null;

  const arm = () => {
    if (stopped) return;
    timer = schedule(() => void fire(), nextSnapshotDelay(opts.random));
  };

  const fire = async () => {
    if (stopped) return;
    try {
      const { bytes } = await capture();
      const entry = await log(opts.attemptId, {
        kind: "webcam_snapshot",
        at: new Date().toISOString(),
        detail: snapshotDetail(bytes),
        bytes,
      });
      const cheat = cheatKindFor("webcam_snapshot");
      if (cheat) {
        try {
          await report(opts.attemptId, cheat, "mock");
        } catch {
          /* monitoring channel is best-effort; the local entry stands */
        }
      }
      if (!stopped) opts.onEvent?.(entry);
    } catch (error) {
      const entry = await log(opts.attemptId, {
        kind: "webcam_blocked",
        at: new Date().toISOString(),
        detail: messageOf(error),
      });
      if (!stopped) opts.onEvent?.(entry);
    } finally {
      arm();
    }
  };

  arm();

  return () => {
    stopped = true;
    if (timer != null) cancel(timer);
    timer = null;
  };
}

/**
 * React wrapper used by the exam runner. Does nothing (and touches no camera)
 * while the exam is inactive or when the device has no camera support.
 */
export function useProctorSnapshots(opts: {
  attemptId: string;
  active: boolean;
  onEvent?: (entry: SecurityLogEntry) => void;
  random?: () => number;
}): { snapshots: number; lastEvent: SecurityLogEntry | null } {
  const { attemptId, active } = opts;
  const [snapshots, setSnapshots] = useState(0);
  const [lastEvent, setLastEvent] = useState<SecurityLogEntry | null>(null);
  const onEventRef = useRef(opts.onEvent);
  onEventRef.current = opts.onEvent;
  const randomRef = useRef(opts.random);
  randomRef.current = opts.random;
  const supported = proctorSupported();

  useEffect(() => {
    if (!active || !supported) return;
    return startProctorSnapshotLoop({
      attemptId,
      random: () => randomRef.current?.() ?? Math.random(),
      onEvent: (entry) => {
        if (entry.kind === "webcam_snapshot") setSnapshots((count) => count + 1);
        setLastEvent(entry);
        onEventRef.current?.(entry);
      },
    });
  }, [active, supported, attemptId]);

  return { snapshots, lastEvent };
}

export default useProctorSnapshots;
