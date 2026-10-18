import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import TitleBar from "./TitleBar";

describe("Native Custom TitleBar Component", () => {
  it("renders app branding, version, and default window controls", () => {
    const html = renderToStaticMarkup(<TitleBar examActive={false} />);
    expect(html).toContain("BestWay Exam");
    expect(html).toContain("v0.8.3");
    expect(html).toContain("data-tauri-drag-region");
    expect(html).toContain('aria-label="Minimize"');
    expect(html).toContain('aria-label="Maximize"');
    expect(html).toContain('aria-label="Close"');
    expect(html).not.toContain("Exam Mode — Fullscreen Protected");
  });

  it("activates protected mode when examActive is true", () => {
    const html = renderToStaticMarkup(<TitleBar examActive={true} />);
    expect(html).toContain("Exam Mode — Fullscreen Protected");
    expect(html).toContain("Imtihon rejimida yopish taqiqlangan");
    expect(html).toContain("disabled");
  });

  it("displays network connectivity indicator", () => {
    const html = renderToStaticMarkup(<TitleBar examActive={false} />);
    expect(html).toMatch(/Online|Offline/);
  });
});
