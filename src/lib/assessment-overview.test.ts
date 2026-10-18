import { describe, expect, it, vi } from "vitest";
import { fetchAssessmentOverview, multilevelScoreToCefr } from "./assessment-overview";

vi.mock("./api", () => ({
  get: vi.fn(async (path: string) => {
    if (path === "/assessment/overview") {
      return {
        user: { id: "u-1", name: "Candidate One", phone: "+998901234567", role: "student" },
        prediction: {
          studentId: "u-1",
          studentName: "Candidate One",
          activeProgram: "IELTS",
          attemptsAnalyzed: 4,
          trend: "improving",
          ielts: {
            currentBand: 6.5,
            predictedBand: 7.0,
            trendDelta: 0.5,
            targetBand: 7.5,
            targetProgressPercent: 93,
            gapToTarget: 0.5,
            cefrLevel: "C1",
          },
          multilevel: {
            currentScore: 56.0,
            predictedScore: 62.0,
            trendDelta: 6.0,
            targetScore: 65.0,
            targetCefr: "C1",
            targetProgressPercent: 95,
            gapToTarget: 3.0,
            cefrLevel: "C1",
          },
          weakModules: [
            {
              module: "Reading — Matching Headings",
              skill: "reading",
              accuracyPercent: 45,
              recommendation: "Focus on skimming topic sentences first.",
              severity: "high",
            },
          ],
        },
      };
    }
    throw new Error(`Unexpected path: ${path}`);
  }),
}));

describe("assessment-overview", () => {
  it("maps 0-75 scores to correct CEFR boundaries", () => {
    expect(multilevelScoreToCefr(0)).toBe("A2");
    expect(multilevelScoreToCefr(33)).toBe("A2");
    expect(multilevelScoreToCefr(34)).toBe("B1");
    expect(multilevelScoreToCefr(45)).toBe("B1");
    expect(multilevelScoreToCefr(46)).toBe("B2");
    expect(multilevelScoreToCefr(59)).toBe("B2");
    expect(multilevelScoreToCefr(60)).toBe("C1");
    expect(multilevelScoreToCefr(75)).toBe("C1");
  });

  it("fetches and parses assessment overview data", async () => {
    const data = await fetchAssessmentOverview();
    expect(data.user.id).toBe("u-1");
    expect(data.prediction.ielts.predictedBand).toBe(7.0);
    expect(data.prediction.multilevel.predictedScore).toBe(62.0);
    expect(data.prediction.multilevel.cefrLevel).toBe("C1");
    expect(data.prediction.weakModules[0].module).toBe("Reading — Matching Headings");
  });
});
