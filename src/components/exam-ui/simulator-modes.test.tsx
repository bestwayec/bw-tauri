import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import BottomNav from "./BottomNav";
import TopBar from "./TopBar";
import { seekAudioToPartStart } from "./ListeningEngine";
import { splitMarks } from "./PassagePane";
import {
  contrastThemePalette,
  dtmQuestionColorClass,
  mockSectionToParts,
  parseAudioStartSec,
} from "./model";
import { examLayout } from "@/lib/exam-layout";
import {
  bandToMultilevelScore,
  computeFallbackPrediction,
  multilevelScoreToBand,
  multilevelScoreToCefr,
} from "@/components/ScorePredictionWidget";
import LiveExamPinJoin, {
  isValidExamPin,
  sanitizeExamPinInput,
} from "@/components/LiveExamPinJoin";
import { generateSixDigitPin } from "@/pages/LiveProctoring";

describe("CDI Simulator Mode — 3 Contrast Themes & Margin Notes", () => {
  it("resolves exact background and text colors for standard, dark (#09090b), and grey (#2d3139)", () => {
    expect(contrastThemePalette("standard")).toEqual({
      bg: "#f4f4f1",
      text: "#111111",
      label: "Standard",
    });
    expect(contrastThemePalette("dark")).toEqual({
      bg: "#09090b",
      text: "#fef08a",
      label: "High Contrast",
    });
    expect(contrastThemePalette("grey")).toEqual({
      bg: "#2d3139",
      text: "#f8fafc",
      label: "Soft Grey",
    });
  });

  it("renders TopBar with CDI contrast switcher, Notes toggle, and Fullscreen toggle", () => {
    const html = renderToStaticMarkup(
      <TopBar
        candidateName="Ali Valiyev"
        sectionTitle="IELTS Academic Reading"
        partLabel="Passage 1"
        remainingMs={1800_000}
        timeUp={false}
        volumeVisible={true}
        volume={80}
        onVolume={() => {}}
        fontSize={17}
        onFontSize={() => {}}
        dark={true}
        onToggleDark={() => {}}
        contrastTheme="dark"
        onContrastThemeChange={() => {}}
        simulatorMode="cdi"
        onSimulatorModeChange={() => {}}
        noteOpen={true}
        onToggleNote={() => {}}
        saveState="saved"
        onHelp={() => {}}
        onExit={() => {}}
      />,
    );
    expect(html).toContain("CDI Mode");
    expect(html).toContain('data-contrast-option="standard"');
    expect(html).toContain('data-contrast-option="dark"');
    expect(html).toContain('data-contrast-option="grey"');
    expect(html).toContain("Toggle full screen");
    expect(html).toContain("Notes");
  });

  it("splits passage text cleanly on highlight and underline spans", () => {
    const segments = splitMarks("BestWay CDI simulator supports highlighting.", ["CDI simulator"], ["highlighting"]);
    expect(segments.some((s) => s.mark && s.text === "CDI simulator")).toBe(true);
    expect(segments.some((s) => s.underline && s.text === "highlighting")).toBe(true);
  });
});

describe("Multi-Level DTM Simulator Mode — Split Layout & Question Palette", () => {
  it("uses vertical split-screen layout in DTM mode across wide viewports even for listening stimulus", () => {
    expect(examLayout(false, 1280, "dtm")).toBe("split");
    expect(examLayout(true, 1280, "dtm")).toBe("split");
    expect(examLayout(false, 1280, "cdi")).toBe("single");
  });

  it("assigns official DTM question palette colors: Green (answered), Grey (unanswered), Yellow (flagged)", () => {
    // Answered (ishlangan) -> Green
    expect(dtmQuestionColorClass(true, false, false)).toBe("bg-emerald-600 text-white");
    // Unseen / Unanswered (ko'rilmagan) -> Grey
    expect(dtmQuestionColorClass(false, false, false)).toBe("bg-slate-600/40 text-slate-200");
    // Flagged / Marked (belgilab qo'yilgan) -> Yellow
    expect(dtmQuestionColorClass(false, true, false)).toBe("bg-amber-400 text-slate-950");
    expect(dtmQuestionColorClass(true, true, false)).toBe("bg-amber-400 text-slate-950");
    // Current question adds ring
    expect(dtmQuestionColorClass(true, false, true)).toContain("bg-emerald-600 text-white");
    expect(dtmQuestionColorClass(true, false, true)).toContain("ring-2 ring-white");
  });

  it("renders BottomNav with DTM green/grey/yellow classes and Uzbek/English legend", () => {
    const html = renderToStaticMarkup(
      <BottomNav
        parts={[{ label: "Part 1", answered: 1, total: 3 }]}
        currentPart={0}
        onPart={() => {}}
        answered={[true, false, false]}
        flagged={[false, true, false]}
        currentQ={0}
        onJumpQ={() => {}}
        onToggleFlag={() => {}}
        onPrev={() => {}}
        onNext={() => {}}
        canPrev={false}
        isLastPart={true}
        submitting={false}
        submitLabel="Submit"
        onSubmit={() => {}}
        simulatorMode="dtm"
      />,
    );
    expect(html).toContain('data-simulator-mode="dtm"');
    expect(html).toContain("bg-emerald-600 text-white");
    expect(html).toContain("bg-amber-400 text-slate-950");
    expect(html).toContain("bg-slate-600/40 text-slate-200");
    expect(html).toContain("ishlangan");
    expect(html).toContain("belgilab qo&#x27;yilgan");
    expect(html).toContain("ko&#x27;rilmagan");
  });
});

describe("Single Audio & Part Timestamps in ListeningEngine", () => {
  it("parses audioStartSec directly or from stimulusRef JSON", () => {
    expect(parseAudioStartSec(125, null)).toBe(125);
    expect(parseAudioStartSec(null, '{"startSec": 240}')).toBe(240);
    expect(parseAudioStartSec(null, '{"audioStartSec": 90}')).toBe(90);
    expect(parseAudioStartSec(null, "invalid-json")).toBeNull();
    expect(parseAudioStartSec(null, null)).toBeNull();
  });

  it("seeks audio element currentTime when switching parts with timestamps", () => {
    const fakeAudio = { currentTime: 0 };
    const jumped = seekAudioToPartStart(fakeAudio, null, '{"startSec": 185}');
    expect(jumped).toBe(185);
    expect(fakeAudio.currentTime).toBe(185);
  });

  it("maps group audioStartSec and stimulusRef onto UIPart in mockSectionToParts", () => {
    const parts = mockSectionToParts(
      {
        id: "sec-listen",
        skill: "listening",
        title: "Listening",
        sortOrder: 0,
        durationMinutes: 35,
        instructions: null,
        groups: [
          {
            id: "g1",
            sortOrder: 0,
            title: "Part 2",
            instructions: null,
            passageText: null,
            contentHtml: null,
            contentLayout: null,
            hasAudio: true,
            audioUrl: "/v1/mock/groups/g1/audio",
            audioStartSec: null,
            stimulusRef: '{"startSec": 310}',
            imageUrl: null,
            partNumber: 2,
            audioDurationSec: 600,
            audioPlayLimit: 1,
            questions: [],
          },
        ],
      },
      "att-99",
      true,
    );
    expect(parts[0].audioStartSec).toBe(310);
    expect(parts[0].stimulusRef).toBe('{"startSec": 310}');
  });
});

describe("Score Prediction CEFR Scale (0–75 ball) & Dual-Scale Conversion", () => {
  it("maps Multi-Level 0-75 scores strictly to A2 (0-33), B1 (34-45), B2 (46-59), C1 (60-75)", () => {
    expect(multilevelScoreToCefr(0)).toBe("A2");
    expect(multilevelScoreToCefr(33)).toBe("A2");
    expect(multilevelScoreToCefr(34)).toBe("B1");
    expect(multilevelScoreToCefr(45)).toBe("B1");
    expect(multilevelScoreToCefr(46)).toBe("B2");
    expect(multilevelScoreToCefr(59)).toBe("B2");
    expect(multilevelScoreToCefr(60)).toBe("C1");
    expect(multilevelScoreToCefr(75)).toBe("C1");
  });

  it("converts between IELTS Band (0-9.0) and Multi-Level (0-75 ball) scales", () => {
    expect(bandToMultilevelScore(9.0)).toBe(75);
    expect(bandToMultilevelScore(6.0)).toBe(50);
    expect(multilevelScoreToBand(75)).toBe(9.0);
    expect(multilevelScoreToBand(50)).toBe(6.0);
  });

  it("computes local fallback prediction with history and weak modules", () => {
    const pred = computeFallbackPrediction(
      [
        {
          id: "a1",
          studentId: "stu-1",
          testId: "t1",
          testTitle: "Mock 1",
          testType: "multilevel",
          status: "completed",
          startedAt: "2026-10-01T10:00:00Z",
          finishedAt: "2026-10-01T11:00:00Z",
          autoScore: 62,
          manualScore: null,
          totalScore: 62,
        },
      ],
      "MULTILEVEL",
    );
    expect(pred.predictedMultilevelScore).toBe(62);
    expect(pred.cefrLevel).toBe("C1");
    expect(pred.weakModules.length).toBeGreaterThan(0);
  });
});

describe("Live Exam 6-Digit PIN Validation", () => {
  it("validates 6-digit numeric PIN codes and rejects invalid inputs", () => {
    expect(isValidExamPin("482910")).toBe(true);
    expect(isValidExamPin("000123")).toBe(true);
    expect(isValidExamPin("12345")).toBe(false);
    expect(isValidExamPin("1234567")).toBe(false);
    expect(isValidExamPin("12a456")).toBe(false);
  });

  it("sanitizes arbitrary input into at most 6 digits and generates valid 6-digit teacher PINs", () => {
    expect(sanitizeExamPinInput("48-29-10-99")).toBe("482910");
    const generated = generateSixDigitPin();
    expect(isValidExamPin(generated)).toBe(true);
  });

  it("renders LiveExamPinJoin with CDI and DTM mode buttons and 6-digit PIN field", () => {
    const html = renderToStaticMarkup(<LiveExamPinJoin />);
    expect(html).toContain("6-Digit PIN");
    expect(html).toContain("IELTS CDI");
    expect(html).toContain("Multi-Level DTM");
    expect(html).toContain('maxLength="6"');
  });
});
