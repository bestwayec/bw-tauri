import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { check } from "@tauri-apps/plugin-updater";
import { get } from "./api";
import { probeDownloadUrl, resolveDesktopUpdate, takeSignedUpdate } from "./version";
import UpdateNotifier from "@/components/UpdateNotifier";

vi.mock("./api", () => ({ get: vi.fn(), post: vi.fn(), API_BASE_URL: "https://api.example.test/v1" }));
vi.mock("@tauri-apps/plugin-updater", () => ({ check: vi.fn() }));

const INSTALLER = "https://bestwayec.uz/media/downloads/Bestway.App_9.9.9_x64-setup.exe";

function signedUpdate(version: string) {
  return { version, currentVersion: "1.0.6", body: "notes", date: undefined, downloadAndInstall: vi.fn() };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
  const values = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
  });
});
afterEach(() => vi.unstubAllGlobals());

describe("resolveDesktopUpdate", () => {
  it("shows no toast when the fallback installer URL returns 404", async () => {
    vi.mocked(check).mockResolvedValue(null);
    vi.mocked(get).mockResolvedValue({ version: "9.9.9", downloadUrl: INSTALLER });
    const fetchMock = vi.fn(async () => new Response(null, { status: 404 }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(resolveDesktopUpdate()).resolves.toBeNull();
    expect(fetchMock).toHaveBeenCalledWith(INSTALLER, expect.objectContaining({ method: "HEAD" }));
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining("toast suppressed"));
  });

  it("shows no toast when latest.json is missing and the installer probe fails", async () => {
    vi.mocked(check).mockRejectedValue(new Error("latest.json 404"));
    vi.mocked(get).mockResolvedValue({ version: "9.9.9", downloadUrl: INSTALLER });
    vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError("network"); }));
    await expect(resolveDesktopUpdate()).resolves.toBeNull();
  });

  it("offers the announced installer only after HEAD confirms it exists", async () => {
    vi.mocked(check).mockResolvedValue(null);
    vi.mocked(get).mockResolvedValue({ version: "9.9.9", downloadUrl: INSTALLER });
    vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 200 })));
    await expect(resolveDesktopUpdate()).resolves.toMatchObject({
      latest: "9.9.9",
      downloadUrl: INSTALLER,
      source: "installer",
    });
  });

  it("takes the version from the signed updater, not the backend announcement", async () => {
    const found = signedUpdate("1.0.10");
    vi.mocked(check).mockResolvedValue(found as never);
    vi.mocked(get).mockResolvedValue({ version: "1.0.9", downloadUrl: INSTALLER });
    const info = await resolveDesktopUpdate();
    expect(info).toMatchObject({ current: "1.0.6", latest: "1.0.10", source: "updater" });
    expect(get).not.toHaveBeenCalled();
    expect(takeSignedUpdate()).toBe(found);
  });

  it("never probes an unsafe URL", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await expect(probeDownloadUrl("javascript:alert(1)")).resolves.toBe(false);
    await expect(probeDownloadUrl("http://evil.test/x.exe")).resolves.toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("UpdateNotifier language", () => {
  const update = { current: "1.0.6", latest: "1.0.10", downloadUrl: INSTALLER, source: "installer" as const };

  it("defaults to Uzbek", () => {
    const html = renderToStaticMarkup(<UpdateNotifier update={update} onClose={() => {}} />);
    expect(html).toContain("Yangi versiya mavjud");
    expect(html).toContain("Bestway Exam 1.0.10 tayyor, sizda 1.0.6");
    expect(html).toContain("Yuklab olish va yangilash");
    expect(html).not.toContain("New version available");
  });

  it("follows the English language setting", () => {
    localStorage.setItem("bestway.language", "en");
    const html = renderToStaticMarkup(<UpdateNotifier update={update} onClose={() => {}} />);
    expect(html).toContain("New version available");
    expect(html).toContain("Bestway Exam 1.0.10 is ready");
    expect(html).toContain("Download &amp; update");
  });
});
