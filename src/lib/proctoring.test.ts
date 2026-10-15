import { afterEach, describe, expect, it, vi } from "vitest";
import { offlineGet, offlinePut } from "./offline-store";
import {
  PROCTOR_SNAPSHOT_MAX_MS,
  PROCTOR_SNAPSHOT_MIN_MS,
  appendSecurityLog,
  captureWebcamSnapshot,
  cheatKindFor,
  clearSecurityLog,
  eventKindFromLockdown,
  logLockdownEvent,
  nextSnapshotDelay,
  proctorSupported,
  readSecurityLog,
  snapshotDetail,
  type SecurityLogEntry,
} from "./proctoring";

afterEach(() => {
  vi.unstubAllGlobals();
});

function stubCamera(stream: MediaStream | null, failure?: unknown) {
  const getUserMedia = failure ? vi.fn().mockRejectedValue(failure) : vi.fn().mockResolvedValue(stream);
  vi.stubGlobal("navigator", { mediaDevices: { getUserMedia } });
  return getUserMedia;
}

function stubCanvas(opts: { context: boolean; dataUrl?: string }) {
  vi.stubGlobal("document", {
    createElement: (tag: string) => {
      if (tag === "video") {
        return { videoWidth: 640, videoHeight: 480, muted: false, playsInline: false, srcObject: null, play: async () => {}, addEventListener: () => {} };
      }
      return {
        width: 0,
        height: 0,
        getContext: () => (opts.context ? { drawImage: () => {} } : null),
        toDataURL: () => opts.dataUrl ?? "data:image/jpeg;base64,",
      };
    },
  });
}

describe("security log", () => {
  it("round-trips entries in order and clears the attempt trail", async () => {
    const first = await appendSecurityLog("attempt-1", { kind: "camera_ready", at: "2026-10-15T10:00:00.000Z" });
    const second = await appendSecurityLog("attempt-1", {
      kind: "webcam_snapshot",
      at: "2026-10-15T10:12:00.000Z",
      detail: snapshotDetail(2048),
      bytes: 2048,
    });
    expect(first.id).toBeTruthy();
    expect(first.attemptId).toBe("attempt-1");
    expect(second.id).not.toBe(first.id);

    const entries = await readSecurityLog("attempt-1");
    expect(entries.map((e) => e.kind)).toEqual(["camera_ready", "webcam_snapshot"]);
    expect(entries[1].bytes).toBe(2048);
    // A different attempt never sees this trail.
    expect(await readSecurityLog("attempt-2")).toEqual([]);

    await clearSecurityLog("attempt-1");
    expect(await readSecurityLog("attempt-1")).toEqual([]);
  });

  it("persists the trail in the shared offline store so a reload keeps it", async () => {
    await appendSecurityLog("attempt-9", { kind: "window_blur", at: "2026-10-15T11:00:00.000Z", detail: "Lockdown event: window:blur" });
    const raw = await offlineGet("security", "attempt-9");
    expect(raw).toBeTruthy();
    const parsed = JSON.parse(raw as string) as SecurityLogEntry[];
    expect(parsed).toHaveLength(1);
    expect(parsed[0].kind).toBe("window_blur");
    expect(await readSecurityLog("attempt-9")).toHaveLength(1);
  });

  it("survives a corrupt stored payload without throwing", async () => {
    await offlinePut("security", "attempt-3", "{not json");
    expect(await readSecurityLog("attempt-3")).toEqual([]);
    await appendSecurityLog("attempt-3", { kind: "focus_lost", at: "2026-10-15T12:00:00.000Z" });
    expect((await readSecurityLog("attempt-3")).map((e) => e.kind)).toEqual(["focus_lost"]);
  });
});

describe("snapshot cadence and event mapping", () => {
  it("keeps random snapshots inside the 10-15 minute window", () => {
    expect(nextSnapshotDelay(() => 0)).toBe(PROCTOR_SNAPSHOT_MIN_MS);
    expect(nextSnapshotDelay(() => 1)).toBe(PROCTOR_SNAPSHOT_MAX_MS);
    expect(nextSnapshotDelay(() => 0.5)).toBe(750_000);
    // Out-of-range or broken random sources clamp instead of returning NaN.
    expect(nextSnapshotDelay(() => -3)).toBe(PROCTOR_SNAPSHOT_MIN_MS);
    expect(nextSnapshotDelay(() => Number.NaN)).toBe(PROCTOR_SNAPSHOT_MIN_MS);
    expect(PROCTOR_SNAPSHOT_MIN_MS).toBe(600_000);
    expect(PROCTOR_SNAPSHOT_MAX_MS).toBe(900_000);
  });

  it("maps lockdown events onto the audit kinds", () => {
    expect(eventKindFromLockdown("visibilitychange:hidden")).toBe("window_minimised");
    expect(eventKindFromLockdown("window:blur")).toBe("window_blur");
    expect(eventKindFromLockdown("keydown:f12")).toBe("focus_lost");
    expect(eventKindFromLockdown("copy")).toBe("focus_lost");
  });

  it("only ever forwards kinds the flag-cheat channel accepts", () => {
    const allowed = ["tab_switch", "blur", "paste", "shortcut"];
    for (const kind of ["focus_lost", "window_blur", "window_minimised", "webcam_snapshot"] as const) {
      const mapped = cheatKindFor(kind);
      expect(mapped).not.toBeNull();
      expect(allowed).toContain(mapped);
    }
    // Local-only camera events are never sent on the cheat channel.
    expect(cheatKindFor("camera_ready")).toBeNull();
    expect(cheatKindFor("webcam_denied")).toBeNull();
    expect(cheatKindFor("webcam_blocked")).toBeNull();
  });

  it("formats the snapshot log line for humans", () => {
    expect(snapshotDetail(512)).toBe("Webcam snapshot (~512 B)");
    expect(snapshotDetail(2048)).toBe("Webcam snapshot (~2 KB)");
    expect(snapshotDetail(2 * 1024 * 1024)).toBe("Webcam snapshot (~2.0 MB)");
    expect(snapshotDetail(0)).toBe("Webcam snapshot (~0 B)");
  });

  it("records a focus loss locally and forwards a valid cheat kind", async () => {
    const report = vi.fn(async () => {});
    const entry = await logLockdownEvent("attempt-4", "window:blur", report);
    expect(entry.kind).toBe("window_blur");
    expect(report).toHaveBeenCalledWith("attempt-4", "blur", "mock");
    expect((await readSecurityLog("attempt-4")).map((e) => e.kind)).toEqual(["window_blur"]);
  });

  it("keeps the local record when the monitoring channel rejects", async () => {
    const report = vi.fn(async () => {
      throw new Error("offline");
    });
    const entry = await logLockdownEvent("attempt-5", "visibilitychange:hidden", report);
    expect(entry.kind).toBe("window_minimised");
    expect((await readSecurityLog("attempt-5")).map((e) => e.kind)).toEqual(["window_minimised"]);
  });
});

describe("webcam snapshot capture", () => {
  it("reports that the camera check is unavailable in a camera-less environment", () => {
    expect(proctorSupported()).toBe(false);
    return expect(captureWebcamSnapshot()).rejects.toThrow(/camera check is unavailable/i);
  });

  it("explains a blocked camera permission instead of throwing raw DOM errors", async () => {
    stubCanvas({ context: true });
    stubCamera(null, Object.assign(new Error("denied"), { name: "NotAllowedError" }));
    await expect(captureWebcamSnapshot()).rejects.toThrow(/permission was blocked/i);
  });

  it("captures a JPEG frame and always releases the camera afterwards", async () => {
    const stop = vi.fn();
    const stream = { getTracks: () => [{ stop }] } as unknown as MediaStream;
    stubCamera(stream);
    stubCanvas({ context: true, dataUrl: `data:image/jpeg;base64,${"A".repeat(4000)}` });

    const shot = await captureWebcamSnapshot();
    expect(shot.dataUrl.startsWith("data:image/jpeg")).toBe(true);
    expect(shot.bytes).toBe(3000);
    expect(stop).toHaveBeenCalledTimes(1);
  });

  it("releases the camera even when the frame cannot be drawn", async () => {
    const stop = vi.fn();
    const stream = { getTracks: () => [{ stop }] } as unknown as MediaStream;
    stubCamera(stream);
    stubCanvas({ context: false });

    await expect(captureWebcamSnapshot({ timeoutMs: 50 })).rejects.toThrow(/could not be captured/i);
    expect(stop).toHaveBeenCalledTimes(1);
  });
});
