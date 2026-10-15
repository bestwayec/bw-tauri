import { Children, isValidElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { MockSectionBody, fullMockChoice, sectionChoices, singleSectionChoice, supportsFullMock } from "./MockSectionPicker";
import type { MockExamListItem, MockSkill } from "@/lib/mocks";

type PickerExam = Pick<MockExamListItem, "title" | "type" | "profile" | "skills" | "questionCount">;

const fullMockExam: PickerExam = {
  title: "Multilevel CBT Full Mock",
  type: "multilevel",
  profile: "full_mock",
  skills: ["listening", "reading", "writing", "speaking"],
  questionCount: 81,
};

const practiceExam: PickerExam = {
  title: "Reading practice",
  type: "multilevel",
  profile: "practice",
  skills: ["reading", "writing"],
  questionCount: 20,
};

function render(exam: PickerExam, mode: "practice" | "timed" = "practice") {
  return renderToStaticMarkup(<MockSectionBody exam={exam} mode={mode} onCancel={() => {}} onStart={() => {}} />);
}

/** The dialog's hook-free body — its buttons can be invoked directly in tests. */
function body(exam: PickerExam, mode: "practice" | "timed", handlers: { onStart: () => void; onCancel: () => void }) {
  return MockSectionBody({
    exam,
    mode,
    onStart: handlers.onStart,
    onCancel: handlers.onCancel,
  });
}

describe("mock start picker", () => {
  it("offers the Full Mock and all four single sections with their durations", () => {
    const html = render(fullMockExam);
    expect(html).toContain('role="dialog"');
    expect(html).toContain("Full Mock Exam");
    expect(html).toContain("Listening → 📖 Reading → ✍️ Writing → 🗣️ Speaking");
    for (const [label, minutes] of [
      ["Listening Only", 35],
      ["Reading Only", 60],
      ["Writing Only", 60],
      ["Speaking Only", 15],
    ] as const) {
      expect(html).toContain(label);
      expect(html).toContain(`~${minutes} min`);
    }
  });

  it("keeps Full Mock available only for a full_mock blueprint", () => {
    expect(supportsFullMock(fullMockExam)).toBe(true);
    expect(supportsFullMock(practiceExam)).toBe(false);
    const practice = render(practiceExam);
    // The disabled Full Mock action is explained instead of silently missing.
    expect(practice).toContain("Not available for this exam");
    expect(practice).toContain("Reading Only");
    expect(practice).toContain("Writing Only");
    // Sections without content are offered but marked as unavailable.
    expect(practice).toContain("Listening Only");
    expect(practice).toContain("Not in this exam");
  });

  it("disables every action while a start request is in flight", () => {
    const html = renderToStaticMarkup(
      <MockSectionBody
        exam={fullMockExam}
        mode="timed"
        busy
        error="Multilevel CBT Full Mock: Start failed (HTTP 500)"
        onCancel={() => {}}
        onStart={() => {}}
      />,
    );
    expect(html).toContain("Starting your attempt…");
    expect(html).toContain("Start failed");
    expect((html.match(/disabled=""/g) ?? []).length).toBe(5);
  });

  it("maps a section choice onto the scoped start payload (skills, not full_test)", () => {
    expect(singleSectionChoice("practice", "writing")).toEqual({
      mode: "practice",
      flow: "single_skill",
      section: "writing",
    });
    expect(singleSectionChoice("timed", "speaking")).toEqual({
      mode: "timed",
      flow: "single_skill",
      section: "speaking",
    });
    expect(fullMockChoice("timed")).toEqual({ mode: "timed", flow: "full_test" });
  });

  it("only enables sections the exam actually contains", () => {
    expect(sectionChoices({ skills: ["reading", "writing"] as MockSkill[] })).toEqual([
      { skill: "listening", enabled: false },
      { skill: "reading", enabled: true },
      { skill: "writing", enabled: true },
      { skill: "speaking", enabled: false },
    ]);
  });

  it("hands the picked scope to onStart and nothing before the student picks", () => {
    const start = vi.fn();
    const cancel = vi.fn();
    const tree = body(fullMockExam, "practice", { onStart: start, onCancel: cancel });
    // Button order inside the dialog: ✕ close, Full Mock, then the four sections.
    const [close, fullMock, listening, reading] = pickableButtons(tree);
    expect(start).not.toHaveBeenCalled();
    expect(fullMock.props.disabled).toBeFalsy();

    close.props.onClick?.();
    expect(cancel).toHaveBeenCalledTimes(1);

    fullMock.props.onClick?.();
    expect(start).toHaveBeenLastCalledWith({ mode: "practice", flow: "full_test" });

    listening.props.onClick?.();
    expect(start).toHaveBeenLastCalledWith({ mode: "practice", flow: "single_skill", section: "listening" });

    reading.props.onClick?.();
    expect(start).toHaveBeenLastCalledWith({ mode: "practice", flow: "single_skill", section: "reading" });
  });

  it("cannot start a Full Mock on a practice-only exam", () => {
    const start = vi.fn();
    const tree = body(practiceExam, "timed", { onStart: start, onCancel: () => {} });
    const [, fullMock] = pickableButtons(tree);
    expect(fullMock.props.disabled).toBe(true);
    expect(start).not.toHaveBeenCalled();
  });
});

/** All <button> elements in a rendered element tree, in document order. */
function pickableButtons(node: ReactNode): ReactElement<{ onClick?: () => void; disabled?: boolean }>[] {
  return Children.toArray(node).flatMap((child) => {
    if (!isValidElement(child)) return [];
    const element = child as ReactElement<{ children?: ReactNode; onClick?: () => void; disabled?: boolean }>;
    if (element.type === "button") return [element];
    return pickableButtons(element.props.children);
  });
}
