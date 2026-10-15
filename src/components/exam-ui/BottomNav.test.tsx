import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import BottomNav, { answeredCount } from "./BottomNav";

const base = {
  parts: [
    { label: "Part 1", answered: 2, total: 3 },
    { label: "Part 2", answered: 0, total: 2 },
  ],
  // Q1 current, Q2 flagged, Q3 answered, Q4-Q5 empty.
  answered: [true, false, true, false, false],
  flagged: [false, true, false, false, false],
  currentPart: 0,
  currentQ: 0,
  onPart: () => {},
  onJumpQ: () => {},
  onToggleFlag: () => {},
  onPrev: () => {},
  onNext: () => {},
  canPrev: false,
  isLastPart: false,
  submitting: false,
  submitLabel: "Submit Reading",
  onSubmit: () => {},
};

describe("part-by-part bottom navigation", () => {
  it("labels the stepper explicitly and shows part progress", () => {
    const html = renderToStaticMarkup(<BottomNav {...base} />);
    expect(html).toContain("Previous Part");
    expect(html).toContain("Next Part");
    expect(html).toContain('role="tablist"');
    expect(html).toContain("Part 1");
    expect(html).toContain("Part 2");
    // Answered/total per part tab and a section-wide progress readout.
    expect(html).toContain("2/3");
    expect(html).toContain("0/2");
    expect(html).toContain("2/5 answered");
    // The first part cannot step back.
    expect(html).toContain('disabled=""');
    expect(answeredCount(base.answered)).toBe(2);
  });

  it("renders a stateful question palette with its legend", () => {
    const html = renderToStaticMarkup(<BottomNav {...base} />);
    for (let i = 1; i <= 5; i++) {
      expect(html).toContain(`aria-label="Question ${i}`);
    }
    expect(html).toContain("answered");
    expect(html).toContain("flagged");
    expect(html).toContain("empty");
    expect(html).toContain('aria-label="Question palette legend"');
    // Question 2 is flagged for review; question 1 is the current one.
    expect(html).toContain(", flagged for review");
    expect(html).toContain(", current");
    expect((html.match(/exam-qbtn-flagged/g) ?? []).length).toBe(1);
    expect((html.match(/exam-qbtn-answered/g) ?? []).length).toBe(1);
    expect((html.match(/exam-qbtn-todo/g) ?? []).length).toBe(2);
    expect((html.match(/exam-qbtn-current/g) ?? []).length).toBe(1);
    // An answered question that is flagged counts as flagged, not answered.
    expect(html).toContain("Question 3, answered");
  });

  it("swaps the Next action for the submit action on the last part", () => {
    const last = renderToStaticMarkup(<BottomNav {...base} isLastPart canPrev />);
    expect(last).toContain("Submit Reading");
    expect(last).not.toContain("Next Part");
    const busy = renderToStaticMarkup(<BottomNav {...base} isLastPart canPrev submitting />);
    expect(busy).toContain("Submitting…");
  });
});
