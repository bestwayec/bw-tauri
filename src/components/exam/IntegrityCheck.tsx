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

function captureFromVideo(video: HTMLVideoElement): { dataUrl: string; bytes: number } | null {
  try {
    const width = video.videoWidth || 640;
    const height = video.videoHeight || 480;
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.drawImage(video, 0, 0, width, height);
    const dataUrl = canvas.toDataURL("image/jpeg", 0.75);
    const bytes = Math.round((dataUrl.length * 3) / 4);
    return { dataUrl, bytes };
  } catch {
    return null;
  }
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
      releasePreview();
    };
  }, [supported]);

  async function takeSnapshot() {
    if (busy) return;
    setBusy(true);
    try {
      let shot: { dataUrl: string; bytes: number } | null = null;
      if (videoRef.current && videoRef.current.videoWidth > 0) {
        shot = captureFromVideo(videoRef.current);
      }
      if (!shot) {
        shot = await captureWebcamSnapshot();
      }
      releasePreview();

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
    <div className="flex min-h-screen w-full items-center justify-center p-4 sm:p-6 bg-[#0B0F17]">
      <section
        className="exam-miccheck mx-auto flex w-full max-w-xl flex-col items-center rounded-3xl border border-white/10 bg-[#111827]/95 p-6 sm:p-8 shadow-2xl backdrop-blur-2xl"
        aria-label="Camera integrity check"
      >
        <div className="exam-miccheck-copy w-full text-center">
          <p className="exam-miccheck-head text-base sm:text-lg font-bold text-white tracking-tight">
            📷 Camera integrity check
          </p>
          <p className="exam-miccheck-note mt-2 text-xs sm:text-sm text-white/70 leading-relaxed max-w-md mx-auto">
            {phase === "ready"
              ? "We take one snapshot before the exam starts and then a few random ones while you work, so your attempt can be verified later."
              : (error ?? "Starting the camera…")}
          </p>
          <p className="exam-miccheck-note mt-1 text-[11px] text-white/40 max-w-md mx-auto">
            Snapshots are stored with your attempt for exam integrity only and are never shared with other students.
          </p>
        </div>

        <div className="my-6 relative aspect-video w-full max-w-md overflow-hidden rounded-2xl border border-white/15 bg-black/80 shadow-inner flex items-center justify-center">
          {supported && (
            <video
              ref={videoRef}
              muted
              playsInline
              autoPlay
              onLoadedMetadata={() => {
                void videoRef.current?.play().catch(() => undefined);
              }}
              aria-label="Camera preview"
              className={`h-full w-full object-cover transition-opacity duration-300 ${phase === "ready" ? "opacity-100" : "opacity-0"}`}
            />
          )}

          {phase === "starting" && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-white/50">
              <div className="h-6 w-6 animate-spin rounded-full border-2 border-emerald-400 border-t-transparent" />
              <span className="text-xs">Starting camera…</span>
            </div>
          )}

          {(phase === "error" || phase === "unsupported") && (
            <div className="absolute inset-0 flex flex-col items-center justify-center p-4 text-center text-white/60">
              <span className="text-2xl mb-1">📷</span>
              <span className="text-xs text-amber-300/90">{error ?? "Camera unavailable"}</span>
            </div>
          )}

          {snapshot && (
            <div className="absolute inset-0 z-10 bg-black">
              <img src={snapshot} alt="Captured snapshot" className="h-full w-full object-cover" />
            </div>
          )}
        </div>

        <div className="exam-miccheck-actions flex flex-wrap items-center justify-center gap-3 w-full">
          <button
            type="button"
            onClick={() => void takeSnapshot()}
            disabled={phase !== "ready" || busy}
            className="exam-btn-primary px-5 py-2.5 rounded-xl font-medium text-sm transition-all"
          >
            {busy ? "Working…" : "Take snapshot & continue"}
          </button>
          <button
            type="button"
            onClick={() => void continueWithoutCamera()}
            disabled={busy}
            className="exam-btn-ghost px-4 py-2.5 rounded-xl font-medium text-sm text-white/70 hover:text-white transition-all"
          >
            Continue without camera
          </button>
          {onCancel && (
            <button
              type="button"
              onClick={onCancel}
              disabled={busy}
              className="exam-btn-ghost px-4 py-2.5 rounded-xl font-medium text-sm text-white/50 hover:text-white transition-all"
            >
              Back
            </button>
          )}
        </div>
      </section>
    </div>
  );
}
