"use client";
import { useCallback, useEffect, useRef, useState } from 'react';
import { recordingKey, recoverRecording, retainRecording, releaseRecording, markActiveRecording } from '@/lib/durable-recordings';
import { startFullSpeakingCapture } from '@/lib/speaking-capture';

export interface MediaPhase { startedAt: string; prepEndsAt: string; expiresAt: string; plays: number; serverTime: string; playLimit: number; responseSeconds?: number; minDurationMs?: number; maxDurationMs?: number; timingPolicy?: 'FULL_RESPONSE_WINDOW_V1' }
function seconds(iso: string, offset: number) { return Math.max(0, Math.ceil((Date.parse(iso) - Date.now() - offset)/1000)); }

/** Server grants each play; only volume is adjustable during timed playback. */
export function MultilevelListening({ prepare, play, load }: {
  prepare: () => Promise<MediaPhase>; play: () => Promise<MediaPhase>; load: () => Promise<Blob>;
}) {
  const [phase, setPhase] = useState<MediaPhase | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [left, setLeft] = useState(0);
  const [src, setSrc] = useState<string | null>(null);
  const audio = useRef<HTMLAudioElement>(null);
  const offset = useRef(0);
  const blobUrl = useRef<string | null>(null);
  const [playing, setPlaying] = useState(false);
  useEffect(() => () => { if (blobUrl.current) URL.revokeObjectURL(blobUrl.current); }, []);
  useEffect(() => {
    if (!phase) return;
    const tick = () => { const remaining = seconds(playing ? phase.expiresAt : phase.prepEndsAt, offset.current); setLeft(remaining); if (playing && remaining === 0) setPlaying(false); };
    tick(); const id = window.setInterval(tick, 250); return () => clearInterval(id);
  }, [phase, playing]);
  async function start() {
    setBusy(true); setError(null);
    try { const next = await prepare(); offset.current = Date.parse(next.serverTime)-Date.now(); setPhase(next); setPlaying(next.plays > 0 && seconds(next.expiresAt, offset.current) > 0); }
    catch (e) { setError(e instanceof Error ? e.message : 'Unable to prepare audio'); }
    finally { setBusy(false); }
  }
  async function playAudio() {
    setBusy(true); setError(null);
    try {
      const next = await play(); setPhase(next); offset.current = Date.parse(next.serverTime)-Date.now();
      if (!blobUrl.current) { blobUrl.current = URL.createObjectURL(await load()); setSrc(blobUrl.current); }
      const el = audio.current;
      if (!el) throw new Error('Audio element unavailable');
      el.src = blobUrl.current; el.currentTime = 0; await el.play(); setPlaying(true);
    } catch (e) { setError(e instanceof Error ? e.message : 'Audio failed to load or play. Contact your supervisor.'); }
    finally { setBusy(false); }
  }
  return <div className="my-3 space-y-2 rounded-lg border border-current/20 p-3">
    <audio ref={audio} src={src ?? undefined} onEnded={() => setPlaying(false)} onError={() => setError('Audio failed to play. Contact your supervisor.')}><track kind="captions" /></audio>
    {!phase ? <button type="button" disabled={busy} onClick={() => void start()}>Preview this part</button> : <>
      <p role="status">{playing ? 'Playing' : left > 0 ? 'Preview' : 'Ready'} · {left}s · {phase.plays}/{phase.playLimit} plays</p>
      <button type="button" disabled={busy || playing || left > 0 || phase.plays >= phase.playLimit} onClick={() => void playAudio()}>Play audio</button>
    </>}
    <label className="block text-sm">Volume <input aria-label="Audio volume" type="range" min="0" max="1" step="0.05" defaultValue="1" onChange={(e) => { if (audio.current) audio.current.volume = Number(e.target.value); }} /></label>
    {busy && <p role="status">Loading audio…</p>}{error && <p role="alert">{error}</p>}
  </div>;
}

/** Microphone preflight, server timing, durable takes and upload acknowledgement. */
export function MultilevelRecorder({ attemptId, questionId, timed, initialHasAudio, startPhase, upload, onUploaded }: {
  attemptId: string; questionId: string; timed: boolean; initialHasAudio: boolean;
  startPhase: () => Promise<MediaPhase>; upload: (blob: Blob) => Promise<unknown>; onUploaded?: () => void;
}) {
  const key = recordingKey(attemptId, questionId);
  const [status, setStatus] = useState('idle');
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<Blob | null>(null);
  const [recorded, setRecorded] = useState(initialHasAudio);
  const [recordedSeconds, setRecordedSeconds] = useState<number | null>(null);
  const [phase, setPhase] = useState<MediaPhase | null>(null);
  const [left, setLeft] = useState(0);
  const [level, setLevel] = useState(0);
  const stream = useRef<MediaStream | null>(null);
  const recorder = useRef<MediaRecorder | null>(null);
  const offset = useRef(0);
  const uploadRef = useRef(upload);
  useEffect(() => { uploadRef.current = upload; }, [upload]);
  const context = useRef<AudioContext | null>(null);
  const onUploadedRef = useRef(onUploaded);
  useEffect(() => { onUploadedRef.current = onUploaded; }, [onUploaded]);
  const retainedRef = useRef<Blob | null>(null);
  const uploading = useRef(false);
  const busy = useRef(false);
  const aliveRef = useRef(true);
  const generation = useRef(0);
  const grantedPhase = useRef<MediaPhase | null>(null);
  const capture = useRef<ReturnType<typeof startFullSpeakingCapture> | null>(null);
  const preparationTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const stage = useCallback((next: string) => {
    busy.current = ['checking','starting','preparing','recording','finalizing','uploading'].includes(next);
    markActiveRecording(key, busy.current);
    if (aliveRef.current) setStatus(next);
  }, [key]);
  const closeMicrophone = useCallback(() => {
    stream.current?.getTracks().forEach((t) => t.stop());
    stream.current = null;
    const ctx = context.current; context.current = null;
    if (ctx && ctx.state !== 'closed') void ctx.close().catch(() => undefined);
  }, []);
  async function send(blob: Blob) {
    if (uploading.current) return;
    uploading.current = true; stage('uploading'); setError(null);
    try { const saved = await uploadRef.current(blob); await releaseRecording(key); retainedRef.current = null; setPending(null); setRecorded(true); const audioDurationMs = saved && typeof saved === 'object' && 'audioDurationMs' in saved && typeof saved.audioDurationMs === 'number' ? saved.audioDurationMs : undefined; if (audioDurationMs != null) setRecordedSeconds(Math.round(audioDurationMs / 100) / 10); stage('saved'); onUploadedRef.current?.(); window.dispatchEvent(new CustomEvent("multilevel:recording-uploaded", { detail: { attemptId, questionId, ...(audioDurationMs != null ? { audioDurationMs } : {}) } })); }
    catch (e) {
      if (e && typeof e === 'object' && 'code' in e && e.code === 'SPEAKING_AUDIO_DURATION_INVALID') {
        try { await releaseRecording(key); retainedRef.current = null; setPending(null); stage('idle'); setError('This recording does not cover the required response time. Start a new response.'); }
        catch { stage('retry'); setError('The invalid take could not be cleared locally. Keep this page open and retry.'); }
      } else { stage('retry'); setError(e instanceof Error ? e.message : 'Upload failed. Your recording is retained; retry upload.'); }
    }
    finally { uploading.current = false; }
  }
  const sendRef = useRef(send);
  useEffect(() => { sendRef.current = send; });
  useEffect(() => {
    let alive = true;
    aliveRef.current = true;
    void recoverRecording(key).then((blob) => { if (alive && blob) { retainedRef.current = blob; setPending(blob); setStatus('retry'); } }).catch(() => { if (alive) setError('Local recording recovery is unavailable.'); });
    const retry = () => { if (retainedRef.current) void sendRef.current(retainedRef.current); };
    window.addEventListener('online', retry);
    return () => { alive = false; aliveRef.current = false; generation.current++; window.removeEventListener('online', retry); if (preparationTimer.current !== null) clearTimeout(preparationTimer.current); capture.current?.cancel(); markActiveRecording(key, false); closeMicrophone(); };
  }, [key, stage, closeMicrophone]);
  useEffect(() => {
    if (!phase) return;
    const id = window.setInterval(() => {
      setLeft(status === 'recording' ? capture.current?.remaining() ?? 0 : seconds(phase.prepEndsAt, offset.current));
    }, 200);
    return () => clearInterval(id);
  }, [phase, status]);
  async function preflight() {
    if (busy.current) return;
    stage('checking'); setError(null);
    const current = ++generation.current;
    try {
      closeMicrophone();
      if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') throw new Error('Microphone recording is unavailable on this device.');
      const input = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (!aliveRef.current || generation.current !== current) { input.getTracks().forEach((track) => track.stop()); return; }
      stream.current = input;
      if (!MediaRecorder.isTypeSupported('audio/webm') && !MediaRecorder.isTypeSupported('audio/mp4')) throw new Error('Recording format is unsupported');
      stage('ready');
      try {
      const ctx = new AudioContext(); context.current = ctx;
      const analyser = ctx.createAnalyser(); ctx.createMediaStreamSource(stream.current).connect(analyser);
      const buffer = new Uint8Array(analyser.fftSize);
      const meter = () => { if (context.current !== ctx || ctx.state === 'closed') return; analyser.getByteTimeDomainData(buffer); setLevel(Math.max(...buffer.map((v) => Math.abs(v-128))) / 128); requestAnimationFrame(meter); };
      meter();
      } catch { /* Input metering is optional; native microphone capture remains available. */ }
    } catch (e) {
      closeMicrophone(); stage('idle');
      const name = e instanceof Error ? e.name : '';
      setError(name === 'NotAllowedError' ? 'Microphone permission denied. Allow microphone access and retry.' : name === 'NotFoundError' ? 'No microphone was found. Connect a microphone and retry.' : e instanceof Error ? e.message : 'Microphone unavailable');
    }
  }
  function beginRecording() {
    if (!stream.current || recorder.current?.state === 'recording') return;
    try {
    const next = grantedPhase.current;
    const duration = next?.responseSeconds ?? (next ? (Date.parse(next.expiresAt) - Date.parse(next.prepEndsAt)) / 1000 : 0);
    const mimeType = MediaRecorder.isTypeSupported('audio/webm') ? 'audio/webm' : 'audio/mp4';
    const mr = new MediaRecorder(stream.current, { mimeType }); recorder.current = mr;
    capture.current = startFullSpeakingCapture(mr, duration, { complete: (blob) => {
      stage('finalizing'); closeMicrophone();
      retainedRef.current = blob; setPending(blob);
      void retainRecording(key, blob).then(() => sendRef.current(blob)).catch(() => { stage('retry'); setError('Could not persist the take locally. Keep this page open and retry upload.'); });
    }, interrupted: () => { closeMicrophone(); stage('idle'); if (aliveRef.current) setError('Recording was interrupted before its full response window completed. Start a new response.'); }, failed: (message) => { closeMicrophone(); stage('idle'); setError(message); } });
    setLeft(duration); stage('recording');
    } catch (e) { closeMicrophone(); stage('idle'); setError(e instanceof Error ? e.message : 'Recording could not start'); }
  }
  async function start() {
    if (busy.current) return;
    stage('starting'); setError(null);
    const current = generation.current;
    try { const next = await startPhase();
      if (!aliveRef.current || generation.current !== current) return;
      offset.current = Date.parse(next.serverTime)-Date.now(); setPhase(next); grantedPhase.current = next;
      if (seconds(next.expiresAt, offset.current) <= 0) throw new Error('This speaking response has expired.');
      const preparation = Math.max(0, Date.parse(next.prepEndsAt) - Date.now() - offset.current);
      setLeft(Math.ceil(preparation / 1000));
      if (preparation > 0) { stage('preparing'); preparationTimer.current = setTimeout(() => { if (aliveRef.current && generation.current === current) beginRecording(); }, preparation); }
      else beginRecording();
    } catch (e) { closeMicrophone(); stage('idle'); setError(e instanceof Error ? e.message : 'Could not start speaking task'); }
  }
  return <div className="my-3 space-y-2 rounded-lg border border-current/20 p-3">
    <p role="status">{recorded && ['idle', 'saved'].includes(status) ? `Recording uploaded${recordedSeconds != null ? ` · ${recordedSeconds}s` : ''}` : status} {phase && ['preparing', 'recording'].includes(status) && `${left}s remaining`}</p>
    {!pending && !(timed && recorded) && <>
      <button type="button" disabled={['checking','starting','preparing','recording','finalizing','uploading'].includes(status)} onClick={() => void preflight()}>Test microphone</button>
      {status === 'ready' && <><meter aria-label="Microphone input level" min="0" max="1" value={level} /><p>Speak and check that the meter responds.</p><button type="button" onClick={() => void start()}>Start response</button></>}
    </>}
    {pending && <button type="button" disabled={status === 'uploading'} onClick={() => void send(pending)}>Retry upload of saved recording</button>}
    {error && <p role="alert">{error}</p>}
  </div>;
}
