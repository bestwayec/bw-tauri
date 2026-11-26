// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import ListeningEngine, {
  claimExclusiveAudio,
  readStrictPlaybackState,
  releaseExclusiveAudio,
  seekAudioToPartStart,
  writeStrictPlaybackState,
} from "./ListeningEngine";

vi.mock("@/lib/media", () => ({
  useBlobMedia: (src: string | null) => ({
    url: src,
    loading: false,
    error: null,
    retry: vi.fn(),
  }),
}));

describe("ListeningEngine helpers and strict persistence", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    releaseExclusiveAudio(null);
  });

  it("enforces exclusive audio playback by pausing any previous active element", () => {
    const first = { pause: vi.fn() } as unknown as HTMLAudioElement;
    const second = { pause: vi.fn() } as unknown as HTMLAudioElement;

    claimExclusiveAudio(first);
    expect(first.pause).not.toHaveBeenCalled();

    claimExclusiveAudio(second);
    expect(first.pause).toHaveBeenCalledTimes(1);
    expect(second.pause).not.toHaveBeenCalled();

    releaseExclusiveAudio(second);
  });

  it("persists strict playback state across component restarts", () => {
    expect(readStrictPlaybackState("attempt-1:part-1")).toEqual({
      started: false,
      ended: false,
      lastTime: 0,
    });

    writeStrictPlaybackState("attempt-1:part-1", {
      started: true,
      ended: true,
      lastTime: 142,
    });

    expect(readStrictPlaybackState("attempt-1:part-1")).toEqual({
      started: true,
      ended: true,
      lastTime: 142,
    });

    const html = renderToStaticMarkup(
      <ListeningEngine
        src="/api/media/part1.mp3"
        title="Part 1"
        strict
        playbackKey="attempt-1:part-1"
      />,
    );
    expect(html).toContain("Audio completed (played once)");
    expect(html).toContain("2:22");
    expect(html).not.toContain("Play Listening Audio");
  });

  it("shows missing audio state honestly when no source is configured", () => {
    const html = renderToStaticMarkup(
      <ListeningEngine src={null} title="Part 1" strict={false} />,
    );
    expect(html).toContain("No audio attached to this part");
  });

  it("seeks audio element to parsed part start timestamp safely", () => {
    const fakeAudio = { currentTime: 0 };
    expect(seekAudioToPartStart(fakeAudio, null, '{"startSec": 84}')).toBe(84);
    expect(fakeAudio.currentTime).toBe(84);
  });
});
