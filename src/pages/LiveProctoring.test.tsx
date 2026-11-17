import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { demoDataEnabled } from "@/lib/demo-data";
import LiveProctoring, { proctorExportRow, type ProctorStudent } from "./LiveProctoring";

const student = (over: Partial<ProctorStudent> = {}): ProctorStudent => ({
  id: "s1", name: "Real Student", phone: "+998900000000", terminal: "PC-01", room: "Room", examTitle: "Mock", examType: "MULTILEVEL",
  currentSection: "READING (3/35)", totalSections: 4, currentSectionIndex: 3, timeElapsedSeconds: 10, timeLimitSeconds: 3600, status: "active",
  antiCheatFlags: { blurCount: 1, shortcutCount: 0, pasteCount: 2, devtoolsCount: 0, multiMonitorAlert: false, events: [] }, ...over,
});

afterEach(() => vi.unstubAllEnvs());

describe("demo data is for dev / demo builds only", () => {
  it("is on for a dev build or a deliberate demo build, off otherwise", () => {
    expect(demoDataEnabled({ DEV: true })).toBe(true);
    expect(demoDataEnabled({ DEV: false, VITE_DEMO_DATA: "true" })).toBe(true);
    expect(demoDataEnabled({ DEV: false })).toBe(false);
    expect(demoDataEnabled({ DEV: false, VITE_DEMO_DATA: "false" })).toBe(false);
    expect(demoDataEnabled({ DEV: false, VITE_DEMO_DATA: "1" })).toBe(false);
    expect(demoDataEnabled({})).toBe(false);
  });

  it("a real (production) session never lists the sample students or the sample room", () => {
    vi.stubEnv("DEV", false);
    vi.stubEnv("VITE_DEMO_DATA", "");
    const html = renderToStaticMarkup(React.createElement(LiveProctoring));
    for (const sample of ["Azamat Karimov", "+998 90 123 45 67", "482910", "Lab 101"]) expect(html).not.toContain(sample);
    expect(html).toContain("Create a Live Exam Room below");
  });

  it("a dev or demo build shows them", () => {
    vi.stubEnv("DEV", true);
    const html = renderToStaticMarkup(React.createElement(LiveProctoring));
    expect(html).toContain("Azamat Karimov");
    expect(html).toContain("482910");
  });
});

describe("room export row", () => {
  it("prints a dash, not an invented 52, when there is no score yet", () => {
    const row = proctorExportRow(student());
    expect(row[7]).toBe("—");        // score
    expect(row[9]).toBe("—");        // band estimate
    expect(row).not.toContain("52");
    expect(row).not.toContain("6.2");
  });

  it("keeps a real score and the server's level, and writes BELOW_B1 out", () => {
    const row = proctorExportRow(student({ estimatedScore: 60, cefrLevel: "C1" }));
    expect(row[7]).toBe("60");
    expect(row[8]).toBe("C1");
    expect(row[9]).toBe("7.2");
    expect(proctorExportRow(student({ estimatedScore: 30, cefrLevel: "BELOW_B1" }))[8]).toBe("Below B1");
    expect(proctorExportRow(student({ estimatedScore: 30 }))[8]).toBe("—");      // no server level: none is worked out
    expect(proctorExportRow(student({ estimatedScore: 0 }))[7]).toBe("0");        // a real zero is a zero
  });
});
