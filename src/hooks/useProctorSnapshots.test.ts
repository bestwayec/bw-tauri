import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PROCTOR_SNAPSHOT_MAX_MS, PROCTOR_SNAPSHOT_MIN_MS, type SecurityLogEntry } from "@/lib/proctoring";
import { startProctorSnapshotLoop, useProctorSnapshots } from "./useProctorSnapshots";

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

function harness(opts: { random?: () => number; capture?: () => Promise<{ dataUrl: string; bytes: number }>; report?: () => Promise<void> } = {}) {
  const scheduled: number[] = [];
  const events: SecurityLogEntry[] = [];
  const capture = vi.fn(opts.capture ?? (async () => ({ dataUrl: "data:image/jpeg;base64,AAAA", bytes: 2048 })));
  const log = vi.fn(async (attemptId: string, entry: Omit<SecurityLogEntry, "id" | "attemptId">) => ({
    id: `entry-${events.length + 1}`,
    attemptId,
    ...entry,
  }));
  const report = vi.fn(opts.report ?? (async () => {}));
  const stop = startProctorSnapshotLoop({
    attemptId: "attempt-1",
    random: opts.random,
    capture,
    log,
    report,
    onEvent: (entry) => events.push(entry),
    schedule: (run, ms) => {
      scheduled.push(ms);
      return setTimeout(run, ms) as unknown as number;
    },
    cancel: (id) => clearTimeout(id as unknown as ReturnType<typeof setTimeout>),
  });
  return { stop, scheduled, capture, log, report, events };
}

describe("proctor snapshot loop", () => {
  it("arms one timer inside the 10-15 minute window and re-arms after each shot", async () => {
    vi.useFakeTimers();
    const { scheduled, capture, log, report, events, stop } = harness({ random: () => 0 });
    expect(scheduled).toEqual([PROCTOR_SNAPSHOT_MIN_MS]);
    expect(capture).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(PROCTOR_SNAPSHOT_MIN_MS);

    expect(capture).toHaveBeenCalledTimes(1);
    expect(log).toHaveBeenCalledTimes(1);
    expect(log.mock.calls[0][0]).toBe("attempt-1");
    expect(log.mock.calls[0][1]).toMatchObject({ kind: "webcam_snapshot", bytes: 2048, detail: "Webcam snapshot (~2 KB)" });
    // The invigilator's live panel gets a valid cheat kind, never a raw event name.
    expect(report).toHaveBeenCalledWith("attempt-1", "blur", "mock");
    expect(events).toHaveLength(1);
    expect(events[0].kind).toBe("webcam_snapshot");
    // ...and the next random shot is already scheduled.
    expect(scheduled).toHaveLength(2);
    stop();
  });

  it("keeps the cadence uniform and never schedules outside the window", async () => {
    vi.useFakeTimers();
    const { scheduled, stop } = harness({ random: () => 0.5 });
    expect(scheduled[0]).toBe(750_000);
    await vi.advanceTimersByTimeAsync(750_000);
    expect(scheduled[1]).toBe(750_000);
    for (const delay of scheduled) {
      expect(delay).toBeGreaterThanOrEqual(PROCTOR_SNAPSHOT_MIN_MS);
      expect(delay).toBeLessThanOrEqual(PROCTOR_SNAPSHOT_MAX_MS);
    }
    stop();
  });

  it("fails silently: a blocked camera is logged locally and never hits the panel", async () => {
    vi.useFakeTimers();
    const { capture, log, report, events, scheduled, stop } = harness({
      random: () => 0,
      capture: async () => {
        throw new Error("Camera permission was blocked.");
      },
    });
    await vi.advanceTimersByTimeAsync(PROCTOR_SNAPSHOT_MIN_MS);

    expect(capture).toHaveBeenCalledTimes(1);
    expect(log).toHaveBeenCalledTimes(1);
    expect(log.mock.calls[0][1]).toMatchObject({ kind: "webcam_blocked", detail: "Camera permission was blocked." });
    expect(report).not.toHaveBeenCalled();
    expect(events[0].kind).toBe("webcam_blocked");
    // The exam continues: the next snapshot is still scheduled.
    expect(scheduled).toHaveLength(2);
    stop();
  });

  it("survives a failing monitoring channel and keeps snapping", async () => {
    vi.useFakeTimers();
    const { report, events, scheduled, stop } = harness({
      random: () => 0,
      report: async () => {
        throw new Error("offline");
      },
    });
    await vi.advanceTimersByTimeAsync(PROCTOR_SNAPSHOT_MIN_MS);
    expect(report).toHaveBeenCalledTimes(1);
    expect(events[0].kind).toBe("webcam_snapshot");
    expect(scheduled).toHaveLength(2);
    stop();
  });

  it("stops cleanly: no pending timer fires after stop()", async () => {
    vi.useFakeTimers();
    const { capture, stop } = harness({ random: () => 0 });
    stop();
    await vi.advanceTimersByTimeAsync(PROCTOR_SNAPSHOT_MAX_MS * 2);
    expect(capture).not.toHaveBeenCalled();
    // A late shot cannot resurrect the loop either.
    stop();
    await vi.advanceTimersByTimeAsync(PROCTOR_SNAPSHOT_MAX_MS);
    expect(capture).not.toHaveBeenCalled();
  });
});

describe("useProctorSnapshots", () => {
  // Plain createElement: this suite is a .ts file, so no JSX here.
  function Probe({ attemptId, active }: { attemptId: string; active: boolean }) {
    const { snapshots, lastEvent } = useProctorSnapshots({ attemptId, active });
    return createElement("p", null, `${snapshots}:${lastEvent ? lastEvent.kind : "none"}`);
  }

  it("renders without touching a camera and never starts during render", () => {
    // No camera in this environment: the hook must stay inert rather than throw.
    expect(renderToStaticMarkup(createElement(Probe, { attemptId: "attempt-1", active: true }))).toBe("<p>0:none</p>");
    expect(renderToStaticMarkup(createElement(Probe, { attemptId: "attempt-1", active: false }))).toBe("<p>0:none</p>");
  });
});
