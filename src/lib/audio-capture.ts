/**
 * Constrained microphone capture for exam speaking answers.
 *
 * Every recorder in the app opens the microphone through `openMicrophone()` so
 * that echo cancellation, noise suppression and automatic gain control are
 * always requested: a quiet lab room, a shared classroom or a laptop speaker
 * leaking the Listening audio must not ruin a graded recording.
 *
 * Dependency-free (no React, no app imports) so it can be unit-tested in the
 * node environment.
 */

/** The exact constraints every reviewer/recorder must request. */
export const AUDIO_CAPTURE_CONSTRAINTS: MediaStreamConstraints = {
  audio: {
    echoCancellation: true,
    noiseSuppression: true,
    autoGainControl: true,
  },
  video: false,
};

/** Whether this build can open a microphone at all (permission aside). */
export function audioCaptureSupported(): boolean {
  try {
    return (
      typeof navigator !== "undefined" && typeof navigator.mediaDevices?.getUserMedia === "function"
    );
  } catch {
    return false;
  }
}

/** Human copy for a getUserMedia failure, keyed by DOMException name. */
export function audioCaptureFailure(error: unknown): string {
  const name =
    typeof error === "object" && error !== null ? (error as { name?: unknown }).name : undefined;
  switch (name) {
    case "NotAllowedError":
    case "PermissionDeniedError":
    case "SecurityError":
      return "Microphone permission was blocked. Allow it in the OS prompt (or system privacy settings) and retry.";
    case "NotFoundError":
    case "DevicesNotFoundError":
      return "No microphone was found. Connect a microphone and retry.";
    case "NotReadableError":
    case "TrackStartError":
      return "The microphone is busy in another app. Close it and retry.";
    case "OverconstrainedError":
      return "This microphone cannot apply the required audio processing. Try another input device.";
    default:
      return "The microphone could not be opened. Check your input device and retry.";
  }
}

/**
 * Open the microphone with echo cancellation, noise suppression and auto gain.
 *
 * Rejects with an `Error` carrying the friendly text and the original
 * DOMException `name` (existing call sites still branch on the name).
 */
export async function openMicrophone(): Promise<MediaStream> {
  if (!audioCaptureSupported()) {
    throw new Error("Microphone recording is unavailable on this device.");
  }
  try {
    return await navigator.mediaDevices.getUserMedia(AUDIO_CAPTURE_CONSTRAINTS);
  } catch (error) {
    const failure = new Error(audioCaptureFailure(error));
    const name =
      typeof error === "object" && error !== null ? (error as { name?: unknown }).name : undefined;
    if (typeof name === "string" && name) failure.name = name;
    throw failure;
  }
}

export interface AudioProcessingFlags {
  echoCancellation: boolean;
  noiseSuppression: boolean;
  autoGainControl: boolean;
}

const NO_PROCESSING: AudioProcessingFlags = {
  echoCancellation: false,
  noiseSuppression: false,
  autoGainControl: false,
};

/**
 * What the browser actually applied to a track. `getSettings()` is optional and
 * may throw on some WebViews, and a device may silently ignore a constraint, so
 * this is always best-effort and never throws.
 */
export function processingFlags(
  track: MediaStreamTrack | null | undefined,
): AudioProcessingFlags {
  if (!track) return { ...NO_PROCESSING };
  try {
    const settings =
      typeof track.getSettings === "function" ? (track.getSettings() as unknown) : undefined;
    if (!settings || typeof settings !== "object") return { ...NO_PROCESSING };
    const raw = settings as Record<string, unknown>;
    return {
      echoCancellation: raw.echoCancellation === true,
      noiseSuppression: raw.noiseSuppression === true,
      autoGainControl: raw.autoGainControl === true,
    };
  } catch {
    return { ...NO_PROCESSING };
  }
}

/** First audio track of a stream, or null. Never throws. */
export function microphoneTrack(
  stream: MediaStream | null | undefined,
): MediaStreamTrack | null {
  try {
    return stream?.getAudioTracks?.()[0] ?? null;
  } catch {
    return null;
  }
}

/** Readable line for the recording UI, e.g. "Noise reduction on · Echo cancellation on · Auto gain on". */
export function processingSummary(track: MediaStreamTrack | null | undefined): string {
  if (!track) return "No microphone selected.";
  const flags = processingFlags(track);
  const part = (label: string, on: boolean) => `${label} ${on ? "on" : "off"}`;
  return [
    part("Noise reduction", flags.noiseSuppression),
    part("Echo cancellation", flags.echoCancellation),
    part("Auto gain", flags.autoGainControl),
  ].join(" · ");
}

/** True when every required processing constraint was actually applied. */
export function processingApplied(track: MediaStreamTrack | null | undefined): boolean {
  const flags = processingFlags(track);
  return flags.echoCancellation && flags.noiseSuppression && flags.autoGainControl;
}
