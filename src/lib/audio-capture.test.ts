import { afterEach, describe, expect, it, vi } from "vitest";
import {
  AUDIO_CAPTURE_CONSTRAINTS,
  audioCaptureSupported,
  microphoneTrack,
  openMicrophone,
  processingApplied,
  processingFlags,
  processingSummary,
} from "./audio-capture";

function fakeTrack(settings: unknown, options: { throwOnGetSettings?: boolean } = {}) {
  return {
    getSettings: options.throwOnGetSettings
      ? () => {
          throw new Error("getSettings is not supported");
        }
      : () => settings,
  } as unknown as MediaStreamTrack;
}

function stubMicrophone(getUserMedia: unknown) {
  vi.stubGlobal("navigator", { mediaDevices: { getUserMedia } });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("microphone constraints", () => {
  it("always requests echo cancellation, noise suppression and auto gain", () => {
    expect(AUDIO_CAPTURE_CONSTRAINTS).toEqual({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      video: false,
    });
  });

  it("reports availability honestly without a mediaDevices API", () => {
    expect(audioCaptureSupported()).toBe(false);
    stubMicrophone(vi.fn());
    expect(audioCaptureSupported()).toBe(true);
    vi.stubGlobal("navigator", {});
    expect(audioCaptureSupported()).toBe(false);
  });
});

describe("openMicrophone", () => {
  it("passes the constrained request and returns the stream", async () => {
    const stream = { id: "stream-1" } as unknown as MediaStream;
    const getUserMedia = vi.fn().mockResolvedValue(stream);
    stubMicrophone(getUserMedia);
    await expect(openMicrophone()).resolves.toBe(stream);
    expect(getUserMedia).toHaveBeenCalledTimes(1);
    expect(getUserMedia).toHaveBeenCalledWith(AUDIO_CAPTURE_CONSTRAINTS);
  });

  it("refuses without a getUserMedia implementation instead of throwing a raw TypeError", async () => {
    vi.stubGlobal("navigator", { mediaDevices: {} });
    await expect(openMicrophone()).rejects.toThrow(/unavailable on this device/i);
  });

  it("explains each failure and keeps the DOMException name for callers", async () => {
    const cases: Array<[string, RegExp]> = [
      ["NotAllowedError", /permission was blocked/i],
      ["PermissionDeniedError", /permission was blocked/i],
      ["SecurityError", /permission was blocked/i],
      ["NotFoundError", /no microphone was found/i],
      ["DevicesNotFoundError", /no microphone was found/i],
      ["NotReadableError", /busy in another app/i],
      ["TrackStartError", /busy in another app/i],
      ["OverconstrainedError", /cannot apply the required audio processing/i],
      ["WeirdError", /could not be opened/i],
    ];
    for (const [name, pattern] of cases) {
      stubMicrophone(vi.fn().mockRejectedValue(Object.assign(new Error("nope"), { name })));
      const failure = await openMicrophone().then(
        () => null,
        (error: unknown) => error as Error,
      );
      expect(failure).toBeInstanceOf(Error);
      const err = failure as Error;
      expect(err.message).toMatch(pattern);
      expect(err.name).toBe(name);
    }
  });

  it("survives a non-object rejection", async () => {
    stubMicrophone(vi.fn().mockRejectedValue("boom"));
    await expect(openMicrophone()).rejects.toThrow(/could not be opened/i);
  });
});

describe("audio processing reporting", () => {
  it("reads the applied settings defensively", () => {
    expect(processingFlags(fakeTrack({ echoCancellation: true, noiseSuppression: true, autoGainControl: true }))).toEqual(
      { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    );
    // A device that ignored the request reports false, not a crash.
    expect(processingFlags(fakeTrack({ echoCancellation: false }))).toEqual({
      echoCancellation: false,
      noiseSuppression: false,
      autoGainControl: false,
    });
    expect(processingFlags(fakeTrack(undefined))).toEqual({
      echoCancellation: false,
      noiseSuppression: false,
      autoGainControl: false,
    });
    expect(processingFlags(fakeTrack({}, { throwOnGetSettings: true }))).toEqual({
      echoCancellation: false,
      noiseSuppression: false,
      autoGainControl: false,
    });
    expect(processingFlags(null)).toEqual({
      echoCancellation: false,
      noiseSuppression: false,
      autoGainControl: false,
    });
    expect(processingFlags(undefined)).toEqual({
      echoCancellation: false,
      noiseSuppression: false,
      autoGainControl: false,
    });
  });

  it("only treats the track as processed when every constraint was applied", () => {
    expect(processingApplied(fakeTrack({ echoCancellation: true, noiseSuppression: true, autoGainControl: true }))).toBe(true);
    expect(processingApplied(fakeTrack({ echoCancellation: true, noiseSuppression: true }))).toBe(false);
  });

  it("summarises the processing for the recording UI", () => {
    expect(processingSummary(null)).toBe("No microphone selected.");
    expect(processingSummary(fakeTrack({ echoCancellation: true, noiseSuppression: true, autoGainControl: true }))).toBe(
      "Noise reduction on · Echo cancellation on · Auto gain on",
    );
    expect(processingSummary(fakeTrack({}))).toBe(
      "Noise reduction off · Echo cancellation off · Auto gain off",
    );
  });

  it("finds the audio track of a stream without throwing", () => {
    const track = fakeTrack({});
    const stream = { getAudioTracks: () => [track] } as unknown as MediaStream;
    expect(microphoneTrack(stream)).toBe(track);
    expect(microphoneTrack(null)).toBeNull();
    expect(
      microphoneTrack({ getAudioTracks: () => [] } as unknown as MediaStream),
    ).toBeNull();
    expect(
      microphoneTrack({
        getAudioTracks: () => {
          throw new Error("detached");
        },
      } as unknown as MediaStream),
    ).toBeNull();
  });
});
