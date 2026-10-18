import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { API_BASE_URL } from "./config";
import {
  clearMediaBlobCache,
  getOrFetchCachedBlobUrl,
  mediaBlobCache,
} from "./media";

describe("Audio Blob Caching (mediaBlobCache)", () => {
  const originalCreateObjectURL = URL.createObjectURL;
  const originalRevokeObjectURL = URL.revokeObjectURL;

  beforeEach(() => {
    clearMediaBlobCache();
    vi.restoreAllMocks();
  });

  afterEach(() => {
    clearMediaBlobCache();
    URL.createObjectURL = originalCreateObjectURL;
    URL.revokeObjectURL = originalRevokeObjectURL;
  });

  it("caches created blob object URLs in global in-memory cache", async () => {
    const fakeBlob = new Blob(["fake audio stream"], { type: "audio/mpeg" });
    const fakeObjectUrl = "blob:https://api.bestwayec.uz/fake-audio-123";

    URL.createObjectURL = vi.fn(() => fakeObjectUrl);
    URL.revokeObjectURL = vi.fn();

    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        status: 200,
        blob: async () => fakeBlob,
      })) as unknown as typeof fetch,
    );

    const baseOrigin = new URL(API_BASE_URL).origin;
    const testUrl = `${baseOrigin}/v1/mock/groups/42/audio?attemptId=7`;

    // First fetch: fetches and populates cache
    const url1 = await getOrFetchCachedBlobUrl(testUrl);
    expect(url1).toBe(fakeObjectUrl);
    expect(mediaBlobCache.get(testUrl)).toBe(fakeObjectUrl);
    expect(fetch).toHaveBeenCalledTimes(1);

    // Second fetch: returns from mediaBlobCache immediately (0ms network latency!)
    const url2 = await getOrFetchCachedBlobUrl(testUrl);
    expect(url2).toBe(fakeObjectUrl);
    expect(fetch).toHaveBeenCalledTimes(1); // No new network call
  });

  it("clears cached media blobs on clearMediaBlobCache", () => {
    const revokeMock = vi.fn();
    URL.revokeObjectURL = revokeMock;

    mediaBlobCache.set("track-1", "blob:track-1");
    mediaBlobCache.set("track-2", "blob:track-2");
    expect(mediaBlobCache.size).toBe(2);

    clearMediaBlobCache();
    expect(mediaBlobCache.size).toBe(0);
    expect(revokeMock).toHaveBeenCalledWith("blob:track-1");
    expect(revokeMock).toHaveBeenCalledWith("blob:track-2");
  });
});
