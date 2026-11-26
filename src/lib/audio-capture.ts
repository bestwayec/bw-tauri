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
      return "Microphone permission was blocked. Allow access in your operating system or browser settings and retry.";
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

export interface AudioInputDevice {
  deviceId: string;
  label: string;
}

/**
 * Enumerate available microphone input devices (best-effort; never throws).
 */
export async function listAudioInputDevices(): Promise<AudioInputDevice[]> {
  try {
    if (typeof navigator === "undefined" || !navigator.mediaDevices?.enumerateDevices) return [];
    const devices = await navigator.mediaDevices.enumerateDevices();
    return devices
      .filter((d) => d.kind === "audioinput")
      .map((d, idx) => ({
        deviceId: d.deviceId,
        label: d.label?.trim() || `Microphone ${idx + 1}`,
      }));
  } catch {
    return [];
  }
}

/**
 * Select the first supported recording MIME type for MediaRecorder, or undefined
 * to let the host runtime pick its default without throwing.
 */
export function selectSupportedAudioMimeType(): string | undefined {
  try {
    if (typeof MediaRecorder === "undefined" || typeof MediaRecorder.isTypeSupported !== "function") {
      return undefined;
    }
    const candidates = [
      "audio/webm;codecs=opus",
      "audio/webm",
      "audio/mp4;codecs=mp4a.40.2",
      "audio/mp4",
      "audio/ogg;codecs=opus",
    ];
    for (const mime of candidates) {
      if (MediaRecorder.isTypeSupported(mime)) return mime;
    }
    return undefined;
  } catch {
    return undefined;
  }
}

/**
 * Report which common listening exam audio codecs the WebView/browser can decode.
 */
export function supportedAudioCodecs(): string[] {
  try {
    if (typeof document === "undefined") return [];
    const audio = document.createElement("audio");
    if (typeof audio?.canPlayType !== "function") return [];
    const probes: Array<[string, string]> = [
      ["mp3", "audio/mpeg"],
      ["aac/m4a", 'audio/mp4; codecs="mp4a.40.2"'],
      ["opus/webm", 'audio/webm; codecs="opus"'],
      ["ogg/vorbis", 'audio/ogg; codecs="vorbis"'],
      ["wav", "audio/wav"],
    ];
    return probes.filter(([, mime]) => audio.canPlayType(mime) !== "").map(([name]) => name);
  } catch {
    return [];
  }
}

/**
 * Open the microphone with echo cancellation, noise suppression and auto gain.
 * Optionally targets a specific `deviceId`. If advanced audio processing
 * constraints fail with OverconstrainedError, gracefully falls back to basic
 * unconstrained audio (`{ audio: true, video: false }`).
 *
 * Rejects with an `Error` carrying the friendly text and the original
 * DOMException `name` (existing call sites still branch on the name).
 */
export async function openMicrophone(deviceId?: string): Promise<MediaStream> {
  if (!audioCaptureSupported()) {
    throw new Error("Microphone recording is unavailable on this device.");
  }
  const constraints: MediaStreamConstraints = deviceId
    ? {
        audio: {
          deviceId: { exact: deviceId },
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
        video: false,
      }
    : AUDIO_CAPTURE_CONSTRAINTS;
  try {
    return await navigator.mediaDevices.getUserMedia(constraints);
  } catch (error) {
    const name =
      typeof error === "object" && error !== null ? (error as { name?: unknown }).name : undefined;

    if (name === "OverconstrainedError" || name === "ConstraintNotSatisfiedError") {
      try {
        return await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
      } catch (fallbackError) {
        const failure = new Error(audioCaptureFailure(fallbackError || error));
        const finalName =
          typeof fallbackError === "object" && fallbackError !== null
            ? (fallbackError as { name?: unknown }).name
            : name;
        if (typeof finalName === "string" && finalName) failure.name = finalName;
        throw failure;
      }
    }

    const failure = new Error(audioCaptureFailure(error));
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
