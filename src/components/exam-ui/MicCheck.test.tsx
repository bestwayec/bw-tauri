import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import MicCheck, {
  MIC_CHECK_SECONDS,
  MIC_PERMISSION_TIMEOUT_MS,
  levelFromSamples,
  micCheckFailure,
  microphoneSupported,
} from "./MicCheck";

describe("speaking microphone check", () => {
  it("runs for five seconds and says so before the student records", () => {
    expect(MIC_CHECK_SECONDS).toBe(5);
    const html = renderToStaticMarkup(<MicCheck />);
    expect(html).toContain("Microphone check");
    expect(html).toContain("Test microphone (5s)");
    expect(html).toContain('aria-label="Microphone check"');
    expect(html).not.toContain("Input level");
  });

  it("waits for the permission prompt instead of looking hung", () => {
    // A permission prompt has no answer for up to 20s; the copy must say so.
    expect(MIC_PERMISSION_TIMEOUT_MS).toBe(20_000);
    const html = renderToStaticMarkup(<MicCheck />);
    expect(html).not.toContain("Waiting for microphone");
  });

  it("reports the build capability honestly instead of throwing", () => {
    // Node test env has no MediaRecorder — the component must render regardless.
    expect(microphoneSupported()).toBe(false);
    const html = renderToStaticMarkup(<MicCheck />);
    expect(html).toContain("Test microphone (5s)");
  });

  it("explains each microphone failure by its DOMException name", () => {
    expect(micCheckFailure({ name: "NotAllowedError" })).toContain("permission was blocked");
    expect(micCheckFailure({ name: "PermissionDeniedError" })).toContain("permission was blocked");
    expect(micCheckFailure({ name: "NotFoundError" })).toContain("No microphone was found");
    expect(micCheckFailure({ name: "NotReadableError" })).toContain("busy in another app");
    expect(micCheckFailure({ name: "OverconstrainedError" })).toContain("cannot be used");
    expect(micCheckFailure(new Error("boom"))).toContain("check failed");
    expect(micCheckFailure(undefined)).toContain("check failed");
  });

  it("measures loudness from analyser samples between 0 and 1", () => {
    expect(levelFromSamples(new Uint8Array([]))).toBe(0);
    // Digital silence centres on 128.
    expect(levelFromSamples(new Uint8Array([128, 128, 128, 128]))).toBe(0);
    // Full-scale square wave clamps to 1.
    expect(levelFromSamples(new Uint8Array([0, 255, 0, 255]))).toBe(1);
    const quiet = levelFromSamples(new Uint8Array([128, 148, 108, 128]));
    expect(quiet).toBeGreaterThan(0);
    expect(quiet).toBeLessThan(1);
  });
});
