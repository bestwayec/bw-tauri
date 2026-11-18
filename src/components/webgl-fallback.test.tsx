import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { hasWebGL, resetWebGLProbeForTests } from "@/lib/webgl";
import BootSplash from "./BootSplash";
import { isLowEndSystem } from "@/lib/device-capability";
import LoginBackdrop from "./LoginBackdrop";
import Login from "@/pages/Login";

/** A DOM whose canvases never yield a WebGL context (GPU blocked, RDP, ...). */
function stubNoWebGL() {
  const getContext = vi.fn(() => null);
  vi.stubGlobal("document", { createElement: vi.fn(() => ({ getContext })) });
  return getContext;
}

beforeEach(() => resetWebGLProbeForTests());
afterEach(() => {
  vi.unstubAllGlobals();
  resetWebGLProbeForTests();
});

describe("without WebGL (getContext returns null)", () => {
  it("detects the missing context instead of throwing", () => {
    const getContext = stubNoWebGL();
    expect(hasWebGL()).toBe(false);
    expect(getContext).toHaveBeenCalledWith("webgl2");
    expect(getContext).toHaveBeenCalledWith("webgl");
  });

  it("renders the login screen: form present, no particle canvas", () => {
    stubNoWebGL();
    const html = renderToStaticMarkup(
      <div>
        <LoginBackdrop webgl={hasWebGL()} reduceMotion={false} />
        <Login onLogin={() => {}} />
      </div>,
    );
    expect(html).toContain("Bestway Exam");
    expect(html).toContain("<button");
    expect(html).not.toContain("<canvas");
    expect(html).not.toContain("mask-image");
  });

  it("shows the static wordmark in the boot splash instead of the 3D logo", () => {
    stubNoWebGL();
    const html = renderToStaticMarkup(<BootSplash />);
    expect(html).toContain('data-testid="static-logo"');
    expect(html).toContain("Best<span>Way</span>");
    expect(html).not.toContain("<canvas");
  });

  it("shows static wordmark when reduced motion is requested even if WebGL is present", () => {
    const html = renderToStaticMarkup(<BootSplash webgl={true} reduceMotion={true} />);
    expect(html).toContain('data-testid="static-logo"');
    expect(html).toContain("Best<span>Way</span>");
  });

  it("reports WebGL when a context is available", () => {
    const loseContext = vi.fn();
    vi.stubGlobal("document", {
      createElement: () => ({ getContext: () => ({ getExtension: () => ({ loseContext }) }) }),
    });
    expect(hasWebGL()).toBe(true);
    expect(loseContext).toHaveBeenCalled();
  });
});

describe("low-end system detection & 4 GB RAM fallback", () => {
  it("triggers fallback when navigator.deviceMemory is unavailable (undefined)", () => {
    vi.stubGlobal("navigator", { deviceMemory: undefined, hardwareConcurrency: 2 });
    expect(isLowEndSystem()).toBe(true);
    const html = renderToStaticMarkup(<BootSplash webgl={true} reduceMotion={false} />);
    expect(html).toContain('data-testid="static-logo"');
  });

  it("triggers fallback when navigator.deviceMemory is exactly 4 GB", () => {
    vi.stubGlobal("navigator", { deviceMemory: 4, hardwareConcurrency: 4 });
    expect(isLowEndSystem()).toBe(true);
    const html = renderToStaticMarkup(<BootSplash webgl={true} reduceMotion={false} />);
    expect(html).toContain('data-testid="static-logo"');
  });

  it("triggers fallback when navigator.deviceMemory is 2 GB", () => {
    vi.stubGlobal("navigator", { deviceMemory: 2, hardwareConcurrency: 2 });
    expect(isLowEndSystem()).toBe(true);
    const html = renderToStaticMarkup(<BootSplash webgl={true} reduceMotion={false} />);
    expect(html).toContain('data-testid="static-logo"');
  });

  it("identifies high-end systems when navigator.deviceMemory is 8 GB", () => {
    vi.stubGlobal("navigator", { deviceMemory: 8, hardwareConcurrency: 8 });
    expect(isLowEndSystem()).toBe(false);
  });
});
