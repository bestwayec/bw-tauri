/** Native capture starts after preparation and always covers the full response window. */
export function startFullSpeakingCapture(recorder: MediaRecorder, responseSeconds: number, callbacks: {
  complete: (blob: Blob) => void; interrupted: () => void; failed: (message: string) => void;
}) {
  if (!Number.isFinite(responseSeconds) || responseSeconds <= 0 || responseSeconds > 120) throw new Error('Speaking timing is unavailable. Refresh this task and retry.');
  const chunks: Blob[] = [];
  let completed = false;
  let interrupted = false;
  let stoppedAt: number | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let startedAt = 0;
  recorder.ondataavailable = (event) => { if (event.data.size) chunks.push(event.data); };
  recorder.onerror = () => { interrupted = true; if (recorder.state === 'recording') recorder.stop(); else callbacks.interrupted(); };
  recorder.onstop = () => {
    clearTimeout(timer);
    const elapsed = stoppedAt == null ? 0 : stoppedAt - startedAt;
    if (interrupted || !completed || elapsed < responseSeconds * 1000 || elapsed > responseSeconds * 1000 + 250) { callbacks.interrupted(); return; }
    const blob = new Blob(chunks, { type: recorder.mimeType });
    if (!blob.size) { callbacks.failed('The microphone produced an empty recording. Check the device and retry.'); return; }
    callbacks.complete(blob);
  };
  recorder.start(1000);
  startedAt = performance.now();
  timer = setTimeout(() => {
    if (recorder.state !== 'recording') return;
    completed = true; stoppedAt = performance.now(); recorder.stop();
  }, responseSeconds * 1000);
  return {
    remaining: () => Math.max(0, Math.ceil((responseSeconds * 1000 - (performance.now() - startedAt)) / 1000)),
    cancel: () => { interrupted = true; clearTimeout(timer); if (recorder.state === 'recording') recorder.stop(); },
  };
}
