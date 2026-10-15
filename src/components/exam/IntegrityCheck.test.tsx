import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import IntegrityCheck, { integrityFailureKind, integrityMessage } from "./IntegrityCheck";

describe("pre-exam camera integrity check", () => {
  it("renders the check card with both paths and the privacy note without a camera", () => {
    const onReady = vi.fn();
    const html = renderToStaticMarkup(<IntegrityCheck attemptId="attempt-1" onReady={onReady} />);
    expect(html).toContain("Camera integrity check");
    expect(html).toContain('aria-label="Camera integrity check"');
    // renderToStaticMarkup escapes the label's ampersand as `&amp;`.
    expect(html).toContain("Take snapshot &amp; continue");
    expect(html).toContain("Continue without camera");
    expect(html).toContain("never shared with other students");
    // No camera in this environment: the snapshot path is offered but disabled,
    // the skip path stays available, and nothing is reported yet.
    expect(html).toMatch(/disabled=""[^>]*>Take snapshot/);
    expect(html).not.toContain("disabled=\"\" class=\"exam-btn-ghost\">Continue without camera");
    expect(onReady).not.toHaveBeenCalled();
  });

  it("explains why the camera is unavailable instead of failing silently", () => {
    const html = renderToStaticMarkup(<IntegrityCheck attemptId="attempt-1" onReady={() => {}} />);
    expect(html).toContain("not available on this device");
  });

  it("offers a back action only when the caller can cancel", () => {
    const withoutCancel = renderToStaticMarkup(<IntegrityCheck attemptId="attempt-1" onReady={() => {}} />);
    expect(withoutCancel).not.toContain(">Back<");
    const withCancel = renderToStaticMarkup(
      <IntegrityCheck attemptId="attempt-1" onReady={() => {}} onCancel={() => {}} />,
    );
    expect(withCancel).toContain(">Back<");
  });

  it("separates a denied permission from a blocked/unavailable camera in the audit log", () => {
    expect(integrityFailureKind(Object.assign(new Error("no"), { name: "NotAllowedError" }))).toBe("webcam_denied");
    expect(integrityFailureKind(Object.assign(new Error("no"), { name: "PermissionDeniedError" }))).toBe("webcam_denied");
    expect(integrityFailureKind(Object.assign(new Error("no"), { name: "NotFoundError" }))).toBe("webcam_blocked");
    expect(integrityFailureKind(new Error("boom"))).toBe("webcam_blocked");
    expect(integrityFailureKind(undefined, true)).toBe("webcam_blocked");
  });

  it("reuses the shared camera copy for the runner's error card", () => {
    expect(integrityMessage(null, true)).toContain("not available on this device");
    expect(integrityMessage(Object.assign(new Error("no"), { name: "NotFoundError" }))).toContain("No camera was found");
    expect(integrityMessage(Object.assign(new Error("no"), { name: "NotReadableError" }))).toContain("busy in another application");
  });
});
