import { describe, expect, it } from "vitest";
import {
  buildAuthorizeUrl,
  isDesktopCallbackUrl,
  parseManualCallbackInput,
  type BrowserLoginState,
} from "./oauth";

describe("oauth dual scheme and 1-click login", () => {
  it("recognizes both bestway-exam and bestway callback schemes", () => {
    expect(isDesktopCallbackUrl("bestway-exam://auth/callback?code=123&state=abc")).toBe(true);
    expect(isDesktopCallbackUrl("bestway://auth/callback?code=123&state=abc")).toBe(true);
    expect(isDesktopCallbackUrl("bestway-exam:auth/callback?code=123")).toBe(true);
    expect(isDesktopCallbackUrl("bestway:auth/callback?code=123")).toBe(true);
    expect(isDesktopCallbackUrl("https://example.com/auth/callback")).toBe(false);
  });

  it("builds login?next=... url with PKCE and desktop parameters", async () => {
    const state: BrowserLoginState = {
      state: "state1234567890abcdef",
      verifier: "verifier1234567890abcdef1234567890abcdef",
      deviceId: "device-12345678",
      createdAt: Date.now(),
    };
    const url = await buildAuthorizeUrl(state);
    expect(url).toContain("/login?next=");
    const parsed = new URL(url);
    const nextParam = parsed.searchParams.get("next");
    expect(nextParam).toBeTruthy();
    expect(nextParam).toContain("/oauth/desktop?");
    expect(nextParam).toContain("device=device-12345678");
    expect(nextParam).toContain("state=state1234567890abcdef");
    expect(nextParam).toContain("redirect=bestway-exam%3A%2F%2Fauth%2Fcallback");
  });

  it("parses manual code input and callback URLs", () => {
    const state: BrowserLoginState = {
      state: "state1234567890abcdef",
      verifier: "verifier",
      deviceId: "device-123",
      createdAt: Date.now(),
    };

    // Raw 6-digit code
    const rawResult = parseManualCallbackInput("849201", state);
    expect(rawResult.code).toBe("849201");
    expect(rawResult.state).toBe("state1234567890abcdef");

    // Full deep-link URL (bestway-exam)
    const fullExam = parseManualCallbackInput(
      "bestway-exam://auth/callback?code=998877&state=state1234567890abcdef",
      state,
    );
    expect(fullExam.code).toBe("998877");
    expect(fullExam.state).toBe("state1234567890abcdef");

    // Full deep-link URL (bestway)
    const fullBw = parseManualCallbackInput(
      "bestway://auth/callback?code=112233&state=state1234567890abcdef",
      state,
    );
    expect(fullBw.code).toBe("112233");
    expect(fullBw.state).toBe("state1234567890abcdef");
  });
});
