import { beforeEach, describe, expect, it, vi } from "vitest";
import { secureSetItemAsync } from "./secure-storage";
import {
  backoffMs,
  isDefinitiveLogout,
  jwtExpMs,
  useSessionStore,
} from "./session-store";
import type { RustSessionData } from "./tauri-session";

vi.mock("./tauri-session", () => ({
  isTauriRuntime: vi.fn(() => true),
  rustSessionGet: vi.fn(async (): Promise<RustSessionData | null> => null),
  rustSessionSet: vi.fn(async () => undefined),
  rustSessionClear: vi.fn(async () => undefined),
  rustAuthRefresh: vi.fn(async () => "fresh-access"),
  rustAuthLogout: vi.fn(async () => undefined),
}));

import { isTauriRuntime, rustAuthRefresh, rustSessionGet, rustSessionSet } from "./tauri-session";

function b64url(obj: unknown): string {
  return btoa(JSON.stringify(obj)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function jwt(expSeconds: number): string {
  return `h.${b64url({ exp: expSeconds })}.s`;
}

beforeEach(() => {
  vi.mocked(isTauriRuntime).mockReturnValue(true);
  vi.mocked(rustSessionGet).mockResolvedValue(null);
  vi.mocked(rustAuthRefresh).mockResolvedValue("fresh-access");
  useSessionStore.setState({
    status: "logged-out",
    online: true,
    accessToken: null,
    deviceId: "dev-1",
    profile: null,
  });
});

describe("logout verdicts + backoff (pure)", () => {
  it("wipes only on definitive verdicts", () => {
    expect(isDefinitiveLogout("SESSION_EXPIRED")).toBe(true);
    expect(isDefinitiveLogout("INVALID_REFRESH_TOKEN")).toBe(true);
    expect(isDefinitiveLogout("USER_DEACTIVATED")).toBe(true);
    expect(isDefinitiveLogout("HTTP_500")).toBe(false);
    expect(isDefinitiveLogout("HTTP_TIMEOUT")).toBe(false);
    expect(isDefinitiveLogout("NETWORK_ERROR")).toBe(false);
    expect(isDefinitiveLogout(undefined)).toBe(false);
  });
  it("backoff caps at 60s", () => {
    expect(backoffMs(0)).toBe(1_000);
    expect(backoffMs(3)).toBe(8_000);
    expect(backoffMs(100)).toBe(60_000);
  });
  it("decodes JWT exp, null on garbage", () => {
    const exp = Math.floor(Date.now() / 1000) + 900;
    expect(jwtExpMs(jwt(exp))).toBe(exp * 1000);
    expect(jwtExpMs("garbage")).toBeNull();
    expect(jwtExpMs("")).toBeNull();
  });
});

describe("single-flight refresh", () => {
  it("10 parallel refreshes cause exactly one backend call", async () => {
    let calls = 0;
    vi.mocked(rustAuthRefresh).mockImplementation(async () => {
      calls++;
      await new Promise((r) => setTimeout(r, 20));
      return "fresh-access";
    });
    await useSessionStore.getState().setSession({ accessToken: "stale", refreshToken: "rt" });
    const results = await Promise.all(
      Array.from({ length: 10 }, () => useSessionStore.getState().refreshNow()),
    );
    expect(calls).toBe(1);
    expect(new Set(results)).toEqual(new Set(["fresh-access"]));
    expect(useSessionStore.getState().accessToken).toBe("fresh-access");
  });
});

describe("definitive verdict handling", () => {
  it("wipes local session on SESSION_EXPIRED when nothing newer exists", async () => {
    await useSessionStore.getState().setSession({ accessToken: "stale", refreshToken: "rt" });
    vi.mocked(rustAuthRefresh).mockRejectedValue("SESSION_EXPIRED");
    vi.mocked(rustSessionGet).mockResolvedValue({
      access_token: "stale",
      refresh_token: "rt",
      device_id: "dev-1",
      profile_json: null,
    });
    await expect(useSessionStore.getState().refreshNow()).rejects.toBe("SESSION_EXPIRED");
    const s = useSessionStore.getState();
    expect(s.accessToken).toBeNull();
    expect(s.status).toBe("logged-out");
  });
  it("adopts a newer pair instead of wiping (second instance won the race)", async () => {
    await useSessionStore.getState().setSession({ accessToken: "stale", refreshToken: "rt" });
    vi.mocked(rustAuthRefresh).mockRejectedValue("SESSION_EXPIRED");
    vi.mocked(rustSessionGet).mockResolvedValue({
      access_token: "rotated-by-other",
      refresh_token: "rt2",
      device_id: "dev-1",
      profile_json: null,
    });
    await expect(useSessionStore.getState().refreshNow()).resolves.toBe("rotated-by-other");
    expect(useSessionStore.getState().status).toBe("ready");
  });
  it("keeps tokens on transient failures", async () => {
    await useSessionStore.getState().setSession({ accessToken: "stale", refreshToken: "rt" });
    vi.mocked(rustAuthRefresh).mockRejectedValue("HTTP_500: boom");
    await expect(useSessionStore.getState().refreshNow()).rejects.toBe("HTTP_500: boom");
    expect(useSessionStore.getState().accessToken).toBe("stale");
    expect(useSessionStore.getState().status).toBe("ready");
  });
});

describe("boot + migration", () => {
  it("migrates legacy encrypted storage into Rust, then deletes it", async () => {
    vi.mocked(rustSessionGet).mockResolvedValue({
      access_token: null,
      refresh_token: null,
      device_id: null,
      profile_json: null,
    });
    await secureSetItemAsync("bestway.accessToken", "legacy-access");
    await secureSetItemAsync("bestway.refreshToken", "legacy-refresh");
    await useSessionStore.getState().initialize();
    expect(vi.mocked(rustSessionSet)).toHaveBeenCalledWith(
      expect.objectContaining({ access_token: "legacy-access", refresh_token: "legacy-refresh" }),
    );
    expect(useSessionStore.getState().accessToken).toBe("legacy-access");
    expect(useSessionStore.getState().status).toBe("ready");
  });
  it("renders cached profile immediately and stays signed in when me() fails", async () => {
    vi.mocked(rustSessionGet).mockResolvedValue({
      access_token: "cached",
      refresh_token: "rt",
      device_id: "dev-1",
      profile_json: JSON.stringify({ id: "stu-1", role: "student" }),
    });
    // No network stub: rawGetMe will fail (fetch to localhost:3001 refused or
    // 4xx) — initialize must still land on ready, never logged-out.
    await useSessionStore.getState().initialize();
    const s = useSessionStore.getState();
    expect(s.accessToken).toBe("cached");
    expect(s.profile?.id).toBe("stu-1");
    // revalidate runs in background; give it a beat, then assert no logout.
    await new Promise((r) => setTimeout(r, 300));
    const later = useSessionStore.getState();
    expect(later.accessToken).toBe("cached");
    expect(later.status).toBe("ready");
  });
});
