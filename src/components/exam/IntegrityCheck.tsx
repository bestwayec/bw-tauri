import { useEffect, useRef, useState } from "react";
import {
  appendSecurityLog,
  cameraFailureMessage,
  captureWebcamSnapshot,
  proctorSupported,
  snapshotDetail,
  type SecurityEventKind,
} from "@/lib/proctoring";

type Props = {
  attemptId: string;
  /** Called once with the integrity snapshot (or a skip) — the exam starts after. */
  onReady: (result: { snapshot: string | null; skipped: boolean }) => void;
  onCancel?: () => void;
};

type Phase = "unsupported" | "starting" | "ready" | "error";

/**
 * Which local audit kind a skip belongs to.
 * A blocked permission is `webcam_denied`; anything else (no device, busy,
 * unsupported webview) is `webcam_blocked`.
 */
export function integrityFailureKind(error: unknown, unsupported = false): SecurityEventKind {
  if (unsupported) return "webcam_blocked";
  const name = typeof error === "object" && error !== null ? (error as { name?: unknown }).name : undefined;
  if (name === "NotAllowedError" || name === "PermissionDeniedError" || name === "SecurityError") {
    return "webcam_denied";
  }
  return "webcam_blocked";
}

/** Friendly copy for the pre-exam camera card. */
export function integrityMessage(error: unknown, unsupported = false): string {
  if (unsupported) {
    return "The camera check is not available on this device. Continue without it — focus and window changes are still recorded.";
  }
  return cameraFailureMessage(error);
}

/**
 * Pre-exam camera integrity check: shows a live preview, takes one snapshot for
 * the attempt's security log and lets the student continue without a camera.
 * Never blocks the exam and never throws into the runner.
 */
export default function IntegrityCheck({ attemptId, onReady, onCancel }: Props) {
  const supported = proctorSupported();
  const [phase, setPhase] = useState<Phase>(supported ? "starting" : "unsupported");
  const [error, setError] = useState<string | null>(
    supported ? null : integrityMessage(null, true),
  );
  const [snapshot, setSnapshot] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  useEffect(() => {
    if (!supported) return;
    let stopped = false;
    void (async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: { width: 640 }, audio: false });
        if (stopped) {
          stream.getTracks().forEach((track) => {
            try {
              track.stop();
            } catch {
              /* ignore */
            }
          });
          return;
        }
        streamRef.current = stream;
        const video = videoRef.current;
        if (video) {
          video.srcObject = stream;
          const played = video.play?.();
          if (played && typeof played.catch === "function") void played.catch(() => undefined);
        }
        setPhase("ready");
        setError(null);
      } catch (e) {
        if (stopped) return;
        setPhase("error");
        setError(integrityMessage(e));
      }
    })();
    return () => {
      stopped = true;
      streamRef.current?.getTracks().forEach((track) => {
        try {
          track.stop();
        } catch {
          /* ignore */
        }
      });
      streamRef.current = null;
    };
  }, [supported]);

  function releasePreview() {
    streamRef.current?.getTracks().forEach((track) => {
      try {
        track.stop();
      } catch {
        /* ignore */
      }
    });
    streamRef.current = null;
  }

  async function takeSnapshot() {
    if (busy) return;
    setBusy(true);
    try {
      releasePreview();
      const shot = await captureWebcamSnapshot();
      await appendSecurityLog(attemptId, {
        kind: "camera_ready",
        at: new Date().toISOString(),
        detail: "Pre-exam camera check passed.",
      });
      await appendSecurityLog(attemptId, {
        kind: "webcam_snapshot",
        at: new Date().toISOString(),
        detail: snapshotDetail(shot.bytes),
        bytes: shot.bytes,
      });
      setSnapshot(shot.dataUrl);
      onReady({ snapshot: shot.dataUrl, skipped: false });
    } catch (e) {
      const kind = integrityFailureKind(e);
      const detail = integrityMessage(e);
      setPhase("error");
      setError(detail);
      await appendSecurityLog(attemptId, { kind, at: new Date().toISOString(), detail });
    } finally {
      setBusy(false);
    }
  }

  async function continueWithoutCamera() {
    if (busy) return;
    setBusy(true);
    try {
      releasePreview();
      await appendSecurityLog(attemptId, {
        kind: integrityFailureKind(new Error(error ?? "skipped"), phase === "unsupported"),
        at: new Date().toISOString(),
        detail: error ?? "Student continued without the camera check.",
      });
      onReady({ snapshot: null, skipped: true });
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="exam-miccheck" aria-label="Camera integrity check">
      <div className="exam-miccheck-copy">
        <p className="exam-miccheck-head">📷 Camera integrity check</p>
        <p className="exam-miccheck-note">
          {phase === "ready"
            ? "We take one snapshot before the exam starts and then a few random ones while you work, so your attempt can be verified later."
            : (error ?? "Starting the camera…")}
        </p>
        <p className="exam-miccheck-note">
          Snapshots are stored with your attempt for exam integrity only and are never shared with other students.
        </p>
      </div>

      {supported && (
        <video
          ref={videoRef}
          muted
          playsInline
          aria-label="Camera preview"
          className="exam-miccheck-audio"
          style={{ maxWidth: 200 }}
        />
      )}

      {snapshot && (
        // Local confirmation only — the stored snapshot lives in the security log.
        <img src={snapshot} alt="" className="exam-miccheck-audio" style={{ maxWidth: 120 }} />
      )}

      <div className="exam-miccheck-actions">
        <button
          type="button"
          onClick={() => void takeSnapshot()}
          disabled={phase !== "ready" || busy}
          className="exam-btn-primary"
        >
          {busy ? "Working…" : "Take snapshot & continue"}
        </button>
        <button type="button" onClick={() => void continueWithoutCamera()} disabled={busy} className="exam-btn-ghost">
          Continue without camera
        </button>
        {onCancel && (
          <button type="button" onClick={onCancel} disabled={busy} className="exam-btn-ghost">
            Back
          </button>
        )}
      </div>
    </section>
  );
}
