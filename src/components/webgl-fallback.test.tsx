import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { hasWebGL, resetWebGLProbeForTests } from "@/lib/webgl";
import BootSplash from "./BootSplash";
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

  it("reports WebGL when a context is available", () => {
    const loseContext = vi.fn();
    vi.stubGlobal("document", {
      createElement: () => ({ getContext: () => ({ getExtension: () => ({ loseContext }) }) }),
    });
    expect(hasWebGL()).toBe(true);
    expect(loseContext).toHaveBeenCalled();
  });
});
