import { useEffect, useRef, useState } from "react";
import type { RunnerQuestion } from "@/lib/tests";
import { markActiveRecording } from '@/lib/durable-recordings';
import { microphoneTrack, openMicrophone, processingSummary } from '@/lib/audio-capture';
import Waveform from './Waveform';

type Props = {
  q: RunnerQuestion;
  num: number;
  fontSize: number;
  /**
   * Mock-exam mode: called with the recorded take so the caller can upload
   * it for teacher grading. Absent in the tests flow (device-only).
   */
  onBlob?: (blob: Blob) => void;
  /** Upload state text shown under the recorder (mock mode only). */
  uploadNote?: string | null;
  recordingKey?: string;
};

const PREP_SECONDS = 60;
const SPEAK_SECONDS = 120;

function fmt(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

function partLabel(prompt: string): string | null {
  const m = prompt.match(/part\s*(\d)/i);
  return m ? `Part ${m[1]}` : null;
}

type RecState = "idle" | "recording" | "recorded" | "error";

/**
 * Speaking stage: cue card + Part 2 style prep/speak timers + local practice
 * recorder. The recording never leaves the device — the graded artifact is
 * the notes/answer text saved on the right. Works without mic (timers + notes
 * still fully usable) and degrades gracefully when denied.
 */
export default function SpeakingPane({ q, num, fontSize, onBlob, uploadNote, recordingKey }: Props) {
  const [prepLeft, setPrepLeft] = useState(PREP_SECONDS);
  const [prepRunning, setPrepRunning] = useState(false);
  const [speakLeft, setSpeakLeft] = useState(SPEAK_SECONDS);
  const [speakRunning, setSpeakRunning] = useState(false);
  const [recState, setRecState] = useState<RecState>("idle");
  const [recError, setRecError] = useState<string | null>(null);
  const [clipUrl, setClipUrl] = useState<string | null>(null);
  // Live stream drives the waveform; the ref stays the single owner for cleanup.
  const [liveStream, setLiveStream] = useState<MediaStream | null>(null);
  const [recElapsed, setRecElapsed] = useState(0);

  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const requesting = useRef(false);
  const alive = useRef(true);
  // Speak timer needs to stop the recorder without stale closures.
  const stopRecordingRef = useRef<() => void>(() => {});
  // Upload callback needs the same treatment (fires from rec.onstop).
  const onBlobRef = useRef(onBlob);
  onBlobRef.current = onBlob;

  const stopTracks = () => {
    streamRef.current?.getTracks().forEach((t) => {
      try {
        t.stop();
      } catch {
        /* ignore */
      }
    });
    streamRef.current = null;
    setLiveStream(null);
  };

  const stopRecording = () => {
    const rec = recorderRef.current;
    if (rec && rec.state !== "inactive") {
      try {
        rec.stop();
      } catch {
        /* ignore */
      }
    } else {
      stopTracks();
      if (recordingKey) markActiveRecording(recordingKey, false);
      setRecState((s) => (s === "recording" ? "idle" : s));
    }
  };
  stopRecordingRef.current = stopRecording;

  // Reset stage when the question changes.
  useEffect(() => {
    setPrepLeft(PREP_SECONDS);
    setPrepRunning(false);
    setSpeakLeft(SPEAK_SECONDS);
    setSpeakRunning(false);
    stopRecordingRef.current();
    setClipUrl((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return null;
    });
    setRecState("idle");
    setRecError(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- question-change reset; recorder fns omitted to avoid re-init loop, keyed on q.id
  }, [q.id]);

  // Prep countdown.
  useEffect(() => {
    if (!prepRunning || prepLeft <= 0) return;
    const t = window.setInterval(() => {
      setPrepLeft((s) => {
        if (s <= 1) {
          window.clearInterval(t);
          setPrepRunning(false);
          return 0;
        }
        return s - 1;
      });
    }, 1000);
    return () => window.clearInterval(t);
  }, [prepRunning, prepLeft <= 0]); // eslint-disable-line react-hooks/exhaustive-deps -- boolean-coerced dep restarts timer exactly at zero; raw prepLeft would reset every tick

  // Pre-warm microphone during prep so audio visualizer is active and confirms mic works
  useEffect(() => {
    if (!prepRunning || liveStream || streamRef.current) return;
    let active = true;
    void openMicrophone()
      .then((stream) => {
        if (active && alive.current) {
          streamRef.current = stream;
          setLiveStream(stream);
        } else {
          stream.getTracks().forEach((t) => t.stop());
        }
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [prepRunning, liveStream]);

  // Speak countdown — auto-stops the recorder at zero.
  useEffect(() => {
    if (!speakRunning || speakLeft <= 0) return;
    const t = window.setInterval(() => {
      setSpeakLeft((s) => {
        if (s <= 1) {
          window.clearInterval(t);
          setSpeakRunning(false);
          stopRecordingRef.current();
          return 0;
        }
        return s - 1;
      });
    }, 1000);
    return () => window.clearInterval(t);
  }, [speakRunning, speakLeft <= 0]); // eslint-disable-line react-hooks/exhaustive-deps -- boolean-coerced dep restarts timer exactly at zero; raw speakLeft would reset every tick

  // Release mic + clip on unmount.
  useEffect(
    () => { alive.current = true; return () => {
      alive.current = false;
      try {
        recorderRef.current?.state !== "inactive" && recorderRef.current?.stop();
      } catch {
        /* ignore */
      }
      stopTracks();
      if (recordingKey && !recorderRef.current) markActiveRecording(recordingKey, false);
      setClipUrl((prev) => {
        if (prev) URL.revokeObjectURL(prev);
        return null;
      });
    }; },
    [],
  );

  async function startRecording() {
    if (requesting.current || recorderRef.current?.state === 'recording') return;
    setRecError(null);
    if (typeof MediaRecorder === "undefined" || !navigator.mediaDevices?.getUserMedia) {
      setRecState("error");
      setRecError("Recording is not supported in this browser build — use the timers + notes instead.");
      return;
    }
    requesting.current = true;
    try {
      if (recordingKey) markActiveRecording(recordingKey, true);
      // Constrained capture: echo cancellation + noise suppression + auto gain, with explicit fallback.
      let stream: MediaStream;
      try {
        stream = await openMicrophone();
      } catch (err) {
        const errName = typeof err === "object" && err !== null ? (err as { name?: unknown }).name : undefined;
        if (errName === "NotAllowedError" || errName === "PermissionDeniedError" || errName === "SecurityError") {
          throw err;
        }
        stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
      }
      if (!alive.current) { stream.getTracks().forEach((track) => track.stop()); if (recordingKey) markActiveRecording(recordingKey, false); return; }
      streamRef.current = stream;
      setLiveStream(stream);
      setRecElapsed(0);
      chunksRef.current = [];
      const rec = new MediaRecorder(stream);
      recorderRef.current = rec;
      rec.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) chunksRef.current.push(e.data);
      };
      rec.onstop = () => {
        stopTracks();
        const blob = new Blob(chunksRef.current, { type: rec.mimeType || "audio/webm" });
        setClipUrl((prev) => {
          if (prev) URL.revokeObjectURL(prev);
          return blob.size > 0 ? URL.createObjectURL(blob) : null;
        });
        if (blob.size < 10240) {
          setRecState("error");
          setRecError("Recording too short (< 10 KB). Please speak clearly and record again.");
          recorderRef.current = null;
          if (recordingKey) markActiveRecording(recordingKey, false);
          return;
        }
        setRecState("recorded");
        recorderRef.current = null;
        try {
          onBlobRef.current?.(blob);
        } catch {
          /* caller surfaces upload errors */
        }
        if (recordingKey) markActiveRecording(recordingKey, false);
      };
      rec.onerror = () => {
        if (rec.state === 'recording') rec.stop();
        else { stopTracks(); if (recordingKey) markActiveRecording(recordingKey, false); }
        setRecState("error");
        setRecError("Recorder failed mid-session — your notes are still saved.");
      };
      rec.start();
      setRecState("recording");
    } catch (e) {
      stopTracks();
      if (recordingKey) markActiveRecording(recordingKey, false);
      setRecState("error");
      const errName = typeof e === "object" && e !== null ? (e as { name?: unknown }).name : undefined;
      const isPermission =
        errName === "NotAllowedError" ||
        errName === "PermissionDeniedError" ||
        errName === "SecurityError" ||
        (e instanceof Error && /permission|blocked|allowed/i.test(e.message));

      if (isPermission) {
        setRecError(
          "Microphone access was denied. Please allow microphone permissions in your operating system settings (Windows: Settings > Privacy > Microphone; macOS: System Settings > Privacy & Security > Microphone), then click Record again."
        );
      } else {
        setRecError(
          e instanceof Error ? e.message : "Microphone blocked — allow access in the OS prompt, or practice with timers + notes.",
        );
      }
    } finally { requesting.current = false; }
  }

  // Elapsed timer for the recorder header (shown with the waveform).
  useEffect(() => {
    if (recState !== "recording") return;
    const id = window.setInterval(() => setRecElapsed((s) => s + 1), 1000);
    return () => window.clearInterval(id);
  }, [recState]);

  const part = partLabel(q.prompt);
  const prepDone = prepLeft <= 0;
  const speakDone = speakLeft <= 0;
  const inputTrack = microphoneTrack(liveStream);

  return (
    <div>
      <div className="rounded-2xl bg-black/40 p-4 ring-1 ring-white/10">
        <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-[#10B981]/80">
          Cue card · Q{num}{part ? ` · ${part}` : ""}
        </p>
        <p className="mt-1.5 whitespace-pre-wrap leading-relaxed text-white/85" style={{ fontSize }}>
          {q.prompt}
        </p>
      </div>

      {/* Timers */}
      <div className="mt-3 grid grid-cols-2 gap-2">
        <div className={`rounded-xl px-3 py-2.5 ring-1 ${prepDone ? "bg-[#10B981]/10 ring-[#10B981]/30" : "bg-black/30 ring-white/10"}`}>
          <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-white/40">✎ Prepare</p>
          <p className={`mt-0.5 font-mono text-xl font-black tabular-nums ${prepDone ? "text-[#10B981]" : "text-white"}`}>
            {prepDone ? "Go! ✓" : fmt(prepLeft)}
          </p>
          <div className="mt-1.5 flex gap-1.5">
            {!prepRunning ? (
              <button
                type="button"
                onClick={() => {
                  if (prepLeft <= 0) setPrepLeft(PREP_SECONDS);
                  setPrepRunning(true);
                }}
                className="btn-ghost rounded-lg px-2.5 py-1 text-[11px] font-bold text-white"
              >
                {prepLeft <= 0 || prepLeft < PREP_SECONDS ? "Restart" : "Start 1:00"}
              </button>
            ) : (
              <button
                type="button"
                onClick={() => setPrepRunning(false)}
                className="btn-ghost rounded-lg px-2.5 py-1 text-[11px] font-bold text-white"
              >
                Pause
              </button>
            )}
          </div>
        </div>
        <div className={`rounded-xl px-3 py-2.5 ring-1 ${speakDone ? "bg-[#10B981]/10 ring-[#10B981]/30" : speakRunning ? "bg-amber-400/10 ring-amber-400/30" : "bg-black/30 ring-white/10"}`}>
          <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-white/40">🎙 Speak</p>
          <p className={`mt-0.5 font-mono text-xl font-black tabular-nums ${speakDone ? "text-[#10B981]" : speakRunning ? "text-amber-200" : "text-white"}`}>
            {speakDone ? "Done ✓" : fmt(speakLeft)}
          </p>
          <div className="mt-1.5 flex gap-1.5">
            {!speakRunning ? (
              <button
                type="button"
                onClick={() => {
                  if (speakLeft <= 0) setSpeakLeft(SPEAK_SECONDS);
                  setSpeakRunning(true);
                }}
                className="btn-ghost rounded-lg px-2.5 py-1 text-[11px] font-bold text-white"
              >
                {speakLeft <= 0 || speakLeft < SPEAK_SECONDS ? "Restart" : "Start 2:00"}
              </button>
            ) : (
              <button
                type="button"
                onClick={() => {
                  setSpeakRunning(false);
                  stopRecording();
                }}
                className="btn-ghost rounded-lg px-2.5 py-1 text-[11px] font-bold text-white"
              >
                Stop
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Recorder */}
      <div className="mt-3 rounded-xl bg-black/30 px-3.5 py-3 ring-1 ring-white/10">
        <div className="flex items-center gap-2">
          <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-white/35">
            Practice recorder {recState === "recording" && <span className="text-red-300">● rec</span>}
          </p>
          <div className="ml-auto flex gap-1.5">
            {recState !== "recording" ? (
              <button
                type="button"
                onClick={() => void startRecording()}
                className="rounded-lg bg-[#10B981]/10 px-2.5 py-1 text-[11px] font-bold text-[#10B981] ring-1 ring-[#10B981]/30 hover:bg-[#10B981]/20"
              >
                ● Record
              </button>
            ) : (
              <button
                type="button"
                onClick={stopRecording}
                className="rounded-lg bg-red-500/15 px-2.5 py-1 text-[11px] font-bold text-red-200 ring-1 ring-red-500/40 hover:bg-red-500/25"
              >
                ■ Stop
              </button>
            )}
          </div>
        </div>
        {(recState === "recording" || (prepRunning && liveStream)) && (
          <div className="mt-2 space-y-1">
            <Waveform stream={liveStream} active bars={32} label={recState === "recording" ? "Practice recording" : "Microphone pre-check"} elapsedSeconds={recElapsed} />
            <p className="text-[10px] leading-relaxed text-white/40">Input processing: {processingSummary(inputTrack)}</p>
          </div>
        )}
        {clipUrl && recState === "recorded" && (
          <>
            <Waveform stream={null} active={false} bars={32} label="Recorded take" />
            <audio controls src={clipUrl} className="mt-2 w-full" aria-label="Your recorded practice take" />
          </>
        )}
        {recError && (
          <div role="alert" className="mt-2.5 rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-[11px] leading-relaxed text-amber-200">
            <div className="flex items-start gap-2.5">
              <span className="text-base leading-none">⚠️</span>
              <div className="flex-1 space-y-1">
                <p className="font-semibold text-amber-100">{recError}</p>
                <button
                  type="button"
                  onClick={() => void startRecording()}
                  className="mt-1 inline-flex items-center gap-1 rounded-md bg-amber-500/20 px-2 py-0.5 text-[10px] font-bold text-amber-200 hover:bg-amber-500/30"
                >
                  ↻ Retry Microphone Access
                </button>
              </div>
            </div>
          </div>
        )}
        {uploadNote && (
          <p className="mt-2 text-[11px] leading-relaxed text-brand-subtle-fg/80">{uploadNote}</p>
        )}
        <p className="mt-1.5 text-[11px] leading-relaxed text-white/25">
          {onBlob ? 'Your original recording is uploaded for assessment and teacher review. Retry retained takes if the connection fails.' : 'Practice recording stays on this device.'}
        </p>
      </div>
    </div>
  );
}
