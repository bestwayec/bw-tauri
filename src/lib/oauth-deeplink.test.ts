import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import { onOpenUrl } from "@tauri-apps/plugin-deep-link";
import { listen } from "@tauri-apps/api/event";
import { post } from "./api";
import {
  deepLinkUrls,
  exchangeCode,
  listenDeepLink,
  listenSingleInstance,
  resetExchangedCodesForTests,
  waitForDeepLink,
} from "./oauth";

vi.mock("./api", () => ({ post: vi.fn(), setSession: vi.fn(async () => undefined) }));
vi.mock("@tauri-apps/plugin-deep-link", () => ({ onOpenUrl: vi.fn(), getCurrent: vi.fn() }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn() }));

const CALLBACK = "bestway-exam://auth/callback?code=abc123&state=s1";

/** Capture the handler a listener registers, so the test can fire payloads. */
function captureHandler<T>(mockFn: Mock, argIndex: number) {
  let handler: ((payload: T) => void) | undefined;
  mockFn.mockImplementation(async (...args: unknown[]) => {
    handler = args[argIndex] as (payload: T) => void;
    return () => undefined;
  });
  return (payload: T) => handler?.(payload);
}

beforeEach(() => {
  vi.clearAllMocks();
  resetExchangedCodesForTests();
  vi.stubGlobal("window", { setTimeout, clearTimeout });
});
afterEach(() => vi.unstubAllGlobals());

const PAYLOADS = [
  ["string", CALLBACK],
  ["array", [CALLBACK]],
] as const;

describe("deep-link payloads", () => {
  it("normalizes string, array and empty payloads", () => {
    expect(deepLinkUrls(CALLBACK)).toEqual([CALLBACK]);
    expect(deepLinkUrls([CALLBACK, "https://evil.test/auth/callback?code=x"])).toEqual([CALLBACK]);
    expect(deepLinkUrls(null)).toEqual([]);
    expect(deepLinkUrls(undefined)).toEqual([]);
    expect(deepLinkUrls(42)).toEqual([]);
  });

  it.each(PAYLOADS)("onOpenUrl delivers a %s payload", async (_kind, payload) => {
    const fire = captureHandler<unknown>(vi.mocked(onOpenUrl) as unknown as Mock, 0);
    const seen: string[] = [];
    await listenDeepLink((url) => seen.push(url));
    fire(payload);
    expect(seen).toEqual([CALLBACK]);
  });

  it.each(PAYLOADS)("single-instance delivers a %s payload", async (_kind, payload) => {
    const fire = captureHandler<{ payload: unknown }>(vi.mocked(listen) as unknown as Mock, 1);
    const seen: string[] = [];
    await listenSingleInstance((url) => seen.push(url));
    fire({ payload });
    expect(seen).toEqual([CALLBACK]);
  });

  it.each(PAYLOADS)("waitForDeepLink resolves for a %s payload", async (_kind, payload) => {
    const fire = captureHandler<unknown>(vi.mocked(onOpenUrl) as unknown as Mock, 0);
    const pending = waitForDeepLink(5_000);
    await vi.waitFor(() => expect(onOpenUrl).toHaveBeenCalled());
    fire(payload);
    await expect(pending).resolves.toBe(CALLBACK);
  });
});

describe("code exchange", () => {
  it("never exchanges the same code twice", async () => {
    vi.mocked(post).mockResolvedValue({ user: { id: "u1", role: "student" }, accessToken: "a", refreshToken: "r" });
    const [first, second] = await Promise.all([
      exchangeCode("abc123", "verifier", "device"),
      exchangeCode("abc123", "verifier", "device"),
    ]);
    const third = await exchangeCode(" abc123 ", "verifier", "device");
    expect(post).toHaveBeenCalledTimes(1);
    expect(second).toBe(first);
    expect(third).toBe(first);
    await exchangeCode("other", "verifier", "device");
    expect(post).toHaveBeenCalledTimes(2);
  });
});
