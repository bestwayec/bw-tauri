import { describe, expect, it } from "vitest";
import {
  canTransitionExamPhase,
  isExamRunningPhase,
  isTerminalExamPhase,
  transitionExamPhase,
  type ExamPhase,
} from "./exam-state";

describe("Unified ExamState machine", () => {
  it("progresses cleanly through the happy path from loading to completed", () => {
    let phase: ExamPhase = "loading";
    phase = transitionExamPhase(phase, "START_READINESS");
    expect(phase).toBe("readiness_check");
    phase = transitionExamPhase(phase, "READY");
    expect(phase).toBe("ready");
    phase = transitionExamPhase(phase, "START_EXAM");
    expect(phase).toBe("in_progress");
    phase = transitionExamPhase(phase, "SECTION_ADVANCE");
    expect(phase).toBe("section_transition");
    phase = transitionExamPhase(phase, "SECTION_READY");
    expect(phase).toBe("in_progress");
    phase = transitionExamPhase(phase, "SUBMIT_START");
    expect(phase).toBe("submitting");
    phase = transitionExamPhase(phase, "SUBMIT_GRADING");
    expect(phase).toBe("grading");
    phase = transitionExamPhase(phase, "SUBMIT_COMPLETE");
    expect(phase).toBe("completed");
    expect(isTerminalExamPhase(phase)).toBe(true);
  });

  it("supports offline disconnect, reconnect, and recovery while active", () => {
    let phase: ExamPhase = "in_progress";
    phase = transitionExamPhase(phase, "DISCONNECT");
    expect(phase).toBe("offline");
    expect(isExamRunningPhase(phase)).toBe(true);
    phase = transitionExamPhase(phase, "RECONNECT");
    expect(phase).toBe("reconnecting");
    phase = transitionExamPhase(phase, "RECOVER_DONE");
    expect(phase).toBe("in_progress");
  });

  it("blocks impossible transitions such as escaping completed or skipping from ready to submitted", () => {
    expect(canTransitionExamPhase("completed", "START_EXAM")).toBe(false);
    expect(canTransitionExamPhase("completed", "FAIL")).toBe(false);
    expect(transitionExamPhase("completed", "START_EXAM")).toBe("completed");

    expect(canTransitionExamPhase("ready", "SUBMIT_COMPLETE")).toBe(false);
    expect(transitionExamPhase("ready", "SUBMIT_COMPLETE")).toBe("ready");
  });

  it("recovers from failure back to readiness or recovery without resetting to completed", () => {
    let phase: ExamPhase = transitionExamPhase("in_progress", "FAIL");
    expect(phase).toBe("failed");
    expect(isExamRunningPhase(phase)).toBe(false);
    phase = transitionExamPhase(phase, "RECOVER_START");
    expect(phase).toBe("recovering");
    phase = transitionExamPhase(phase, "RECOVER_DONE");
    expect(phase).toBe("in_progress");
  });
});
