import { useEffect, useRef, useState } from "react";
import type { RunnerQuestion } from "@/lib/tests";
import { markActiveRecording } from '@/lib/durable-recordings';

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
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (!alive.current) { stream.getTracks().forEach((track) => track.stop()); if (recordingKey) markActiveRecording(recordingKey, false); return; }
      streamRef.current = stream;
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
        setRecState(blob.size > 0 ? "recorded" : "idle");
        recorderRef.current = null;
        if (blob.size > 0) {
          try {
            onBlobRef.current?.(blob);
          } catch {
            /* caller surfaces upload errors */
          }
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
    } catch {
      stopTracks();
      if (recordingKey) markActiveRecording(recordingKey, false);
      setRecState("error");
      setRecError("Microphone blocked — allow access in the OS prompt, or practice with timers + notes.");
    } finally { requesting.current = false; }
  }

  const part = partLabel(q.prompt);
  const prepDone = prepLeft <= 0;
  const speakDone = speakLeft <= 0;

  return (
    <div>
      <div className="rounded-2xl bg-black/40 p-4 ring-1 ring-white/10">
        <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-[#89F336]/80">
          Cue card · Q{num}{part ? ` · ${part}` : ""}
        </p>
        <p className="mt-1.5 whitespace-pre-wrap leading-relaxed text-white/85" style={{ fontSize }}>
          {q.prompt}
        </p>
      </div>

      {/* Timers */}
      <div className="mt-3 grid grid-cols-2 gap-2">
        <div className={`rounded-xl px-3 py-2.5 ring-1 ${prepDone ? "bg-[#89F336]/10 ring-[#89F336]/30" : "bg-black/30 ring-white/10"}`}>
          <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-white/40">✎ Prepare</p>
          <p className={`mt-0.5 font-mono text-xl font-black tabular-nums ${prepDone ? "text-[#89F336]" : "text-white"}`}>
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
        <div className={`rounded-xl px-3 py-2.5 ring-1 ${speakDone ? "bg-[#89F336]/10 ring-[#89F336]/30" : speakRunning ? "bg-amber-400/10 ring-amber-400/30" : "bg-black/30 ring-white/10"}`}>
          <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-white/40">🎙 Speak</p>
          <p className={`mt-0.5 font-mono text-xl font-black tabular-nums ${speakDone ? "text-[#89F336]" : speakRunning ? "text-amber-200" : "text-white"}`}>
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
                className="rounded-lg bg-[#89F336]/10 px-2.5 py-1 text-[11px] font-bold text-[#89F336] ring-1 ring-[#89F336]/30 hover:bg-[#89F336]/20"
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
        {clipUrl && recState === "recorded" && (
          <audio controls src={clipUrl} className="mt-2 w-full" aria-label="Your recorded practice take" />
        )}
        {recError && (
          <p role="alert" className="mt-2 text-[11px] leading-relaxed text-amber-200/90">{recError}</p>
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
