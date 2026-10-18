import { beforeEach, describe, expect, it, vi } from "vitest";
import pkg from "../../package.json";
import { get } from "./api";
import {
  APP_VERSION,
  DESKTOP_INSTALLER_URL,
  DESKTOP_INSTALLER_VERSION,
  checkForUpdate,
  compareVersions,
  installerUrlFor,
  shouldNotifyUpdate,
} from "./version";

vi.mock("./api", () => ({ get: vi.fn(), API_BASE_URL: "https://api.example.test/v1" }));

beforeEach(() => {
  vi.clearAllMocks();
});

describe("bundled desktop version", () => {
  it("matches package.json so the app never compares itself against an older release", () => {
    expect(APP_VERSION).toBe("0.8.3");
    expect(APP_VERSION).toBe(pkg.version);
    // The manual-installer channel must point at this exact release.
    expect(DESKTOP_INSTALLER_VERSION).toBe(pkg.version);
    expect(DESKTOP_INSTALLER_URL).toContain(`Bestway.App_${pkg.version}_x64`);
    expect(DESKTOP_INSTALLER_URL.startsWith("https://")).toBe(true);
  });
});

describe("shouldNotifyUpdate", () => {
  it("is silent when the app is current or newer than the announcement", () => {
    expect(shouldNotifyUpdate("0.5.6", "0.5.6")).toBe(false);
    expect(shouldNotifyUpdate("0.5.6", "0.5.3")).toBe(false);
    expect(shouldNotifyUpdate("0.5.6", "0.5.2")).toBe(false);
    expect(shouldNotifyUpdate("0.5.6", "")).toBe(false);
    expect(shouldNotifyUpdate("0.5.6", "latest")).toBe(false);
    expect(shouldNotifyUpdate("", "0.5.7")).toBe(false);
  });

  it("announces a strictly newer release only", () => {
    expect(shouldNotifyUpdate("0.5.6", "0.5.7")).toBe(true);
    expect(shouldNotifyUpdate("0.5.6", "0.6.0")).toBe(true);
    expect(shouldNotifyUpdate("0.5.6", "1.0")).toBe(true);
    expect(shouldNotifyUpdate("0.5.6", " 0.5.7 ")).toBe(true);
  });
});

describe("installerUrlFor", () => {
  it("keeps a safe backend download URL", () => {
    expect(installerUrlFor("0.5.7", "https://cdn.example.test/app-0.5.7.exe")).toBe(
      "https://cdn.example.test/app-0.5.7.exe",
    );
    expect(installerUrlFor("0.5.7", "http://localhost:3001/pkg.exe")).toBe(
      "http://localhost:3001/pkg.exe",
    );
  });

  it("refuses unsafe download URLs and never substitutes another release", () => {
    expect(installerUrlFor("0.9.9", "javascript:alert(1)")).toBeNull();
    expect(installerUrlFor("0.9.9", "http://evil.test/pkg.exe")).toBeNull();
    expect(installerUrlFor("0.9.9", "file:///etc/passwd")).toBeNull();
    expect(installerUrlFor("0.9.9", null)).toBeNull();
  });

  it("falls back to the published installer of exactly this release", () => {
    expect(installerUrlFor(pkg.version, null)).toBe(DESKTOP_INSTALLER_URL);
    expect(installerUrlFor(pkg.version, "javascript:alert(1)")).toBe(DESKTOP_INSTALLER_URL);
  });
});

describe("compareVersions", () => {
  it("orders numeric dot-separated versions", () => {
    expect(compareVersions("0.5.6", "0.5.6")).toBe(0);
    expect(compareVersions("0.5.6", "0.5.7")).toBe(-1);
    expect(compareVersions("0.5.7", "0.5.6")).toBe(1);
    expect(compareVersions("0.10.0", "0.9.9")).toBe(1);
    expect(compareVersions("1.0", "1.0.0")).toBe(0);
  });
});

describe("checkForUpdate", () => {
  it("never nags when the backend advertises an older release than this build", async () => {
    vi.mocked(get).mockResolvedValueOnce({ version: "0.5.3", downloadUrl: null });
    await expect(checkForUpdate()).resolves.toBeNull();
  });

  it("returns the advertised release with a safe installer URL", async () => {
    vi.mocked(get).mockResolvedValueOnce({
      version: "0.9.9",
      downloadUrl: "https://cdn.example.test/app-0.5.7.exe",
    });
    await expect(checkForUpdate()).resolves.toEqual({
      current: APP_VERSION,
      latest: "0.9.9",
      downloadUrl: "https://cdn.example.test/app-0.5.7.exe",
    });
  });

  it("nulls an unsafe download URL instead of offering it", async () => {
    vi.mocked(get).mockResolvedValueOnce({ version: "0.9.9", downloadUrl: "javascript:alert(1)" });
    await expect(checkForUpdate()).resolves.toEqual({
      current: APP_VERSION,
      latest: "0.9.9",
      downloadUrl: null,
    });
  });

  it("stays silent when the announcement is unreachable or malformed", async () => {
    vi.mocked(get).mockRejectedValueOnce(new Error("offline"));
    await expect(checkForUpdate()).resolves.toBeNull();
    vi.mocked(get).mockResolvedValueOnce({ version: "", downloadUrl: null });
    await expect(checkForUpdate()).resolves.toBeNull();
  });
});
