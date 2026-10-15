import { useEffect, useRef, useState } from "react";

/** Length of the microphone test take, in seconds. */
export const MIC_CHECK_SECONDS = 5;

type Status = "idle" | "checking" | "listening" | "done" | "error";

const BARS = 16;

/** How long to wait for the browser/OS microphone permission decision. */
export const MIC_PERMISSION_TIMEOUT_MS = 20_000;

/** Whether this build can record audio at all (WebView permission aside). */
export function microphoneSupported(): boolean {
  try {
    return (
      typeof navigator !== "undefined" &&
      typeof navigator.mediaDevices?.getUserMedia === "function" &&
      typeof MediaRecorder !== "undefined"
    );
  } catch {
    return false;
  }
}

/** Human copy for a getUserMedia/MediaRecorder failure (DOMException names). */
export function micCheckFailure(error: unknown): string {
  const name = typeof error === "object" && error !== null ? (error as { name?: unknown }).name : undefined;
  switch (name) {
    case "NotAllowedError":
    case "PermissionDeniedError":
    case "SecurityError":
      return "Microphone permission was blocked. Allow it in the OS prompt (or system privacy settings) and test again.";
    case "NotFoundError":
    case "DevicesNotFoundError":
      return "No microphone was found. Plug one in, then test again.";
    case "NotReadableError":
    case "TrackStartError":
      return "The microphone is busy in another app. Close it and test again.";
    case "OverconstrainedError":
      return "This microphone cannot be used for a 5 second test. Try another input device.";
    default:
      return "The microphone check failed. You can still take the section, but your recording may not upload.";
  }
}

/** 0..1 loudness from the time-domain samples of an analyser — pure + tested. */
export function levelFromSamples(samples: Uint8Array): number {
  if (samples.length === 0) return 0;
  let sum = 0;
  for (let i = 0; i < samples.length; i++) {
    const centred = (samples[i] - 128) / 128;
    sum += centred * centred;
  }
  return Math.min(1, Math.sqrt(sum / samples.length) * 4);
}

/**
 * Five-second microphone check shown at the top of a Speaking section.
 *
 * Records a short take, meters the live input level and plays the take back so
 * the student hears what the exam will upload. Never blocks the exam: on any
 * failure it explains what happened and the section remains takeable.
 */
export default function MicCheck() {
  const [status, setStatus] = useState<Status>("idle");
  const [left, setLeft] = useState(MIC_CHECK_SECONDS);
  const [level, setLevel] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [clipUrl, setClipUrl] = useState<string | null>(null);
  const [hidden, setHidden] = useState(false);

  const supports = microphoneSupported();
  const permissionTimer = useRef<number | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const rafRef = useRef<number | null>(null);
  const timerRef = useRef<number | null>(null);
  const alive = useRef(true);

  function cleanup() {
    if (permissionTimer.current) window.clearTimeout(permissionTimer.current);
    permissionTimer.current = null;
    if (timerRef.current) window.clearInterval(timerRef.current);
    timerRef.current = null;
    if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
    streamRef.current?.getTracks().forEach((t) => {
      try {
        t.stop();
      } catch {
        /* ignore */
      }
    });
    streamRef.current = null;
    try {
      void audioCtxRef.current?.close();
    } catch {
      /* ignore */
    }
    audioCtxRef.current = null;
  }

  useEffect(
    () => () => {
      alive.current = false;
      cleanup();
      setClipUrl((prev) => {
        if (prev) URL.revokeObjectURL(prev);
        return null;
      });
    },
    [],
  );

  function meter(stream: MediaStream) {
    try {
      const Ctor =
        typeof AudioContext !== "undefined"
          ? AudioContext
          : (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return;
      const ctx = new Ctor();
      audioCtxRef.current = ctx;
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 256;
      ctx.createMediaStreamSource(stream).connect(analyser);
      const samples = new Uint8Array(analyser.fftSize);
      const tick = () => {
        if (!alive.current) return;
        analyser.getByteTimeDomainData(samples);
        setLevel(levelFromSamples(samples));
        rafRef.current = requestAnimationFrame(tick);
      };
      rafRef.current = requestAnimationFrame(tick);
    } catch {
      /* metering is a nice-to-have — the test itself still works */
    }
  }

  async function start() {
    if (status === "listening" || status === "checking") return;
    setError(null);
    setClipUrl((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return null;
    });
    setLevel(0);
    setLeft(MIC_CHECK_SECONDS);
    if (!supports) {
      setStatus("error");
      setError("Recording is not available in this build — you can still take the section with notes.");
      return;
    }
    // The browser permission prompt can stay open indefinitely — say so instead
    // of looking like a dead button.
    setStatus("checking");
    permissionTimer.current = window.setTimeout(() => {
      if (!alive.current) return;
      setStatus((s) => (s === "checking" ? "error" : s));
      setError((e) => e ?? "No answer from the microphone permission prompt — allow access in your browser or OS settings, then test again.");
    }, MIC_PERMISSION_TIMEOUT_MS);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (permissionTimer.current) window.clearTimeout(permissionTimer.current);
      permissionTimer.current = null;
      if (!alive.current) {
        stream.getTracks().forEach((t) => t.stop());
        return;
      }
      streamRef.current = stream;
      meter(stream);
      chunksRef.current = [];
      const rec = new MediaRecorder(stream);
      recorderRef.current = rec;
      rec.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) chunksRef.current.push(e.data);
      };
      rec.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: rec.mimeType || "audio/webm" });
        cleanup();
        recorderRef.current = null;
        if (!alive.current) return;
        setLevel(0);
        if (blob.size > 0) {
          setClipUrl((prev) => {
            if (prev) URL.revokeObjectURL(prev);
            return URL.createObjectURL(blob);
          });
          setStatus("done");
        } else {
          setStatus("error");
          setError("Nothing was recorded — check the input device and test again.");
        }
      };
      rec.onerror = () => {
        cleanup();
        recorderRef.current = null;
        setStatus("error");
        setError("The recorder failed during the check. Test again before you start speaking.");
      };
      rec.start();
      setStatus("listening");
      let remaining = MIC_CHECK_SECONDS;
      timerRef.current = window.setInterval(() => {
        remaining -= 1;
        setLeft(Math.max(0, remaining));
        if (remaining <= 0 && timerRef.current) {
          window.clearInterval(timerRef.current);
          timerRef.current = null;
          try {
            if (rec.state !== "inactive") rec.stop();
          } catch {
            /* ignore */
          }
        }
      }, 1000);
    } catch (e) {
      cleanup();
      setStatus("error");
      setError(micCheckFailure(e));
    }
  }

  if (hidden) {
    return (
      <button
        type="button"
        onClick={() => setHidden(false)}
        className="exam-miccheck-reopen"
        aria-label="Open the microphone check"
      >
        🎙 Mic check
      </button>
    );
  }

  const label =
    status === "checking"
      ? "Waiting for microphone…"
      : status === "listening"
        ? `Listening… ${left}s`
        : status === "done"
          ? "Test again (5s)"
          : `Test microphone (5s)`;

  const busy = status === "checking" || status === "listening";

  return (
    <section className="exam-miccheck" aria-label="Microphone check">
      <div className="exam-miccheck-copy">
        <p className="exam-miccheck-head">🎙 Microphone check</p>
        <p className="exam-miccheck-note">
          {status === "done"
            ? "Play your take back below — if you can hear yourself clearly, this is exactly what the exam will upload."
            : status === "checking"
              ? "Waiting for the browser/OS microphone permission — click Allow when it appears."
              : `Record ${MIC_CHECK_SECONDS} seconds and listen back before you start. Speaking answers are graded from your recording.`}
        </p>
      </div>

      {status === "listening" && (
        <div className="exam-miccheck-meter" role="img" aria-label={`Input level ${Math.round(level * 100)} percent`}>
          {Array.from({ length: BARS }, (_, i) => (
            <span
              key={i}
              className={`exam-miccheck-bar${level * BARS > i ? " exam-miccheck-bar-on" : ""}`}
            />
          ))}
        </div>
      )}

      <div className="exam-miccheck-actions">
        {clipUrl && <audio controls src={clipUrl} className="exam-miccheck-audio" aria-label="Your microphone test take" />}
        <button type="button" onClick={() => void start()} disabled={busy} className="exam-btn-primary">
          {label}
        </button>
        <button type="button" onClick={() => setHidden(true)} className="exam-btn-ghost">
          Hide
        </button>
      </div>

      {status === "done" && !clipUrl && <p className="exam-miccheck-note">Recording finished.</p>}
      {error && (
        <p role="alert" className="exam-miccheck-error">
          {error}
        </p>
      )}
    </section>
  );
}
