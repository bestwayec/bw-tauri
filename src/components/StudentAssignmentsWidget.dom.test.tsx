// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { StudentAssignmentsWidget } from "./StudentAssignmentsWidget";
import type { StudentAssignmentItem } from "@/lib/assignments";

vi.mock("@/lib/assignments", () => ({ fetchMyAssignments: vi.fn() }));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const base = {
  cohort_id: "cohort-1",
  cohort_name: "Group A",
  deadline: "2026-11-25T18:00:00Z",
  min_pass_percent: 70,
  is_overdue: false,
};

const assignments: StudentAssignmentItem[] = [
  { ...base, id: "a-vocab", title: "Unit 5 words", is_submitted: false, score_percent: null, is_passed: false, status: "pending", vocabulary_set_id: "set-5", exam_id: null },
  { ...base, id: "a-exam", title: "Mock #1", is_submitted: false, score_percent: null, is_passed: false, status: "pending", vocabulary_set_id: null, exam_id: "exam-1", can_launch_exam: true },
  { ...base, id: "a-locked", title: "Locked mock", is_submitted: false, score_percent: null, is_passed: false, status: "pending", vocabulary_set_id: null, exam_id: "exam-2", can_launch_exam: false },
  { ...base, id: "a-done", title: "Grammar quiz", is_submitted: true, score_percent: 91.6, is_passed: true, status: "passed", vocabulary_set_id: null, exam_id: null },
  { ...base, id: "a-unscored", title: "Reviewed essay", is_submitted: true, score_percent: null, is_passed: true, status: "passed", vocabulary_set_id: null, exam_id: null },
];

let container: HTMLDivElement;
let root: Root;

function render(props: Partial<Parameters<typeof StudentAssignmentsWidget>[0]> = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  client.setQueryData(["my-assignments", "student-1"], assignments);
  const handlers = { onNavigate: vi.fn(), onStartExam: vi.fn(), onSelectVocabulary: vi.fn(), ...props };
  act(() => {
    root.render(
      <QueryClientProvider client={client}>
        <StudentAssignmentsWidget userId="student-1" {...handlers} />
      </QueryClientProvider>,
    );
  });
  return handlers;
}

const tab = (name: RegExp) =>
  Array.from(container.querySelectorAll<HTMLButtonElement>('[role="tab"]')).find((el) => name.test(el.textContent ?? ""))!;
const button = (text: string) =>
  Array.from(container.querySelectorAll<HTMLButtonElement>("button")).filter((el) => el.textContent?.includes(text));

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe("StudentAssignmentsWidget interactions", () => {
  it("passes the exact assignment id to vocabulary and exam actions", () => {
    const handlers = render();
    act(() => button("Lug‘atni o‘rganish")[0].click());
    expect(handlers.onSelectVocabulary).toHaveBeenCalledWith("a-vocab");
    // The server-locked exam must not offer a launch action.
    expect(button("Imtihonni boshlash")).toHaveLength(1);
    act(() => button("Imtihonni boshlash")[0].click());
    expect(handlers.onStartExam).toHaveBeenCalledWith("a-exam");
    expect(handlers.onNavigate).not.toHaveBeenCalled();
  });

  it("falls back to the vocabulary route only when no deep-link handler exists", () => {
    const handlers = render({ onSelectVocabulary: undefined });
    act(() => button("Lug‘atni o‘rganish")[0].click());
    expect(handlers.onNavigate).toHaveBeenCalledWith("vocabulary");
  });

  it("filters by tab on click and never renders a missing score as a number", () => {
    render();
    act(() => tab(/Tugallangan/).click());
    const panel = container.querySelector('[role="tabpanel"]')!;
    expect(panel.textContent).toContain("Grammar quiz");
    expect(panel.textContent).toContain("Bajarildi (92%)");
    expect(panel.textContent).toContain("Reviewed essay");
    expect(panel.textContent).not.toContain("null");
    expect(panel.textContent).not.toContain("Unit 5 words");
    expect(panel.getAttribute("aria-labelledby")).toBe("assignments-tab-completed");
  });

  it("supports roving arrow/Home/End keyboard navigation between tabs", () => {
    render();
    const active = tab(/Faol/);
    active.focus();
    expect(active.tabIndex).toBe(0);
    expect(tab(/Barchasi/).tabIndex).toBe(-1);
    act(() => active.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true })));
    expect(document.activeElement).toBe(tab(/Barchasi/));
    expect(tab(/Barchasi/).getAttribute("aria-selected")).toBe("true");
    act(() => document.activeElement!.dispatchEvent(new KeyboardEvent("keydown", { key: "End", bubbles: true })));
    expect(document.activeElement).toBe(tab(/Tugallangan/));
    act(() => document.activeElement!.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true })));
    expect(document.activeElement).toBe(tab(/Faol/));
    act(() => document.activeElement!.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowLeft", bubbles: true })));
    expect(document.activeElement).toBe(tab(/Tugallangan/));
  });
});
