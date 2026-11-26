import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import DeviceReadinessModal, {
  buildRedactedDiagnosticReport,
  readinessBadge,
} from "./DeviceReadinessModal";
import { APP_VERSION } from "@/lib/version";

describe("DeviceReadinessModal", () => {
  it("does not render when open is false", () => {
    const html = renderToStaticMarkup(<DeviceReadinessModal open={false} onClose={() => {}} />);
    expect(html).toBe("");
  });

  it("renders diagnostics and readiness checks when open is true", () => {
    const html = renderToStaticMarkup(<DeviceReadinessModal open={true} onClose={() => {}} />);
    expect(html).toContain("Device Readiness Center");
    expect(html).toContain("Tarmoq va Server Aloqasi (Connectivity)");
    expect(html).toContain("Audio va Quloqchin (Sound Output)");
    expect(html).toContain("Mikrofon (Speaking Microphone)");
    expect(html).toContain("Veb-kamera (Camera)");
    expect(html).toContain(`App: v${APP_VERSION} (Tauri v2)`);
    expect(html).toContain("Sinov ovozi (Play Chime)");
    expect(html).toContain("Diagnostika hisobotini yuklash");
  });

  it("renders proceed button when onProceed is provided", () => {
    const html = renderToStaticMarkup(
      <DeviceReadinessModal open={true} onClose={() => {}} onProceed={() => {}} />
    );
    expect(html).toContain("Imtihonni boshlash →");
  });

  it("maps statuses to truthful PASS/WARNING/FAIL/UNVERIFIED badges", () => {
    expect(readinessBadge("pass")).toBe("PASS");
    expect(readinessBadge("warn")).toBe("WARNING");
    expect(readinessBadge("fail")).toBe("FAIL");
    expect(readinessBadge("pending")).toBe("UNVERIFIED");
    expect(readinessBadge("checking")).toBe("UNVERIFIED");
  });

  it("produces a redacted diagnostic report without tokens or student PII", () => {
    const raw = buildRedactedDiagnosticReport({
      networkStatus: "pass",
      latencyMs: 42,
      audioHeard: true,
      micStatus: "pass",
      cameraStatus: "pending",
      storageStatus: "pass",
      storageRwOk: true,
      storageAvailableMb: 512,
      viewport: { width: 1366, height: 768, dpr: 1 },
      queuedExamCount: 0,
      pendingRecordings: false,
      sessionAuthenticated: true,
      role: "student",
      codecs: ["mp3", "opus/webm"],
    });
    const parsed = JSON.parse(raw);
    expect(parsed.appVersion).toBe(APP_VERSION);
    expect(parsed.checks.network.status).toBe("PASS");
    expect(parsed.checks.camera.status).toBe("UNVERIFIED");
    expect(parsed.checks.storage.readWriteOk).toBe(true);
    expect(raw).not.toMatch(/Bearer|accessToken|refreshToken|password/i);
  });
});
