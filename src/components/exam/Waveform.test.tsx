import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import Waveform, { DEFAULT_WAVEFORM_BARS, waveformLevels } from "./Waveform";

describe("waveformLevels", () => {
  it("returns one level per bar", () => {
    expect(waveformLevels(new Uint8Array([128, 128, 128, 128]), 4)).toHaveLength(4);
    expect(waveformLevels(new Uint8Array([]), 3)).toEqual([0, 0, 0]);
    // A nonsense bar count still yields at least one bar.
    expect(waveformLevels(new Uint8Array([128]), 0)).toHaveLength(1);
  });

  it("is silent for a centred signal and loud for a square wave", () => {
    expect(waveformLevels(new Uint8Array([128, 128, 128, 128]), 2)).toEqual([0, 0]);
    expect(waveformLevels(new Uint8Array([0, 255, 0, 255]), 2)).toEqual([1, 1]);
  });

  it("keeps partial loudness between 0 and 1", () => {
    const levels = waveformLevels(new Uint8Array([128, 148, 128, 148, 128, 148, 128, 148]), 2);
    for (const level of levels) {
      expect(level).toBeGreaterThan(0);
      expect(level).toBeLessThan(1);
    }
  });
});

describe("waveform rendering", () => {
  it("renders an inert bar row with no stream (SSR / offline)", () => {
    const html = renderToStaticMarkup(<Waveform stream={null} active={false} />);
    expect(html).toContain('role="img"');
    expect(html).toContain('aria-label="Microphone waveform"');
    expect(html).toContain('data-active="false"');
    expect((html.match(/<span/g) ?? []).length).toBe(DEFAULT_WAVEFORM_BARS);
    // No recording copy leaks into an idle render.
    expect(html).not.toContain("recording");
  });

  it("follows the bars prop and labels the row", () => {
    const html = renderToStaticMarkup(
      <Waveform stream={null} active={false} bars={8} label="Practice recording" />,
    );
    expect((html.match(/<span/g) ?? []).length).toBe(8);
    expect(html).toContain('aria-label="Practice recording waveform"');
  });

  it("renders an active take without an AudioContext (node env) and shows the timer", () => {
    const stream = {} as MediaStream;
    const html = renderToStaticMarkup(
      <Waveform stream={stream} active bars={6} label="Microphone input" elapsedSeconds={75} />,
    );
    expect(html).toContain('data-active="true"');
    expect(html).toContain('aria-label="Microphone input waveform recording"');
    expect((html.match(/<span/g) ?? []).length).toBe(7); // 6 bars + the timer span
    expect(html).toContain("1:15");
  });

  it("does not print a timer when no elapsed time is given", () => {
    const html = renderToStaticMarkup(<Waveform stream={null} active={false} />);
    expect(html).not.toContain("⏱");
  });
});
