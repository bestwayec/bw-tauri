import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { UnifiedStudentProfileModal } from "./UnifiedStudentProfileModal";
import type { ClassroomStudentHistory } from "@/lib/group-contract.generated";

function createClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
      },
    },
  });
}

describe("UnifiedStudentProfileModal", () => {
  const sampleHistory: ClassroomStudentHistory = {
    studentId: "student-123",
    name: "Alisher Navoiy",
    groupId: "group-456",
    groupName: "IELTS Intensive B2",
    currentlyEnrolled: true,
    membership: [{ startedAt: "2026-09-01T00:00:00Z", endedAt: null }],
    attendance: [
      { date: "2026-11-01", state: "present" },
      { date: "2026-11-03", state: "present" },
      { date: "2026-11-05", state: "late" },
    ],
    homework: [
      {
        assignment_id: "hw-1",
        assignment__title: "Essay Writing Task 1",
        assignment__vocabulary_set_id: null,
        status: "graded",
        score_percent: 85,
        is_passed: true,
        completed_at: "2026-11-02T10:00:00Z",
      },
    ],
    mockExams: [
      {
        id: "mock-1",
        exam__title: "Full IELTS Mock #4",
        started_at: "2026-11-04T09:00:00Z",
        overall_band: 7.5,
        overall_score: null,
      },
    ],
    tests: [],
    feedback: [
      {
        attempt_id: "att-1",
        skill: "Writing",
        approved_feedback: "Excellent cohesion and vocabulary variety.",
        feedback_text: "Excellent cohesion and vocabulary variety.",
        final_score: 7.5,
      },
    ],
  };

  it("renders accessible modal with student profile details and active enrollment", () => {
    const client = createClient();
    client.setQueryData(
      ["classroom-student-history", "teacher-1", "group-456", "student-123"],
      sampleHistory,
    );

    const html = renderToStaticMarkup(
      <QueryClientProvider client={client}>
        <UnifiedStudentProfileModal
          groupId="group-456"
          studentId="student-123"
          userId="teacher-1"
          onClose={vi.fn()}
        />
      </QueryClientProvider>,
    );

    expect(html).toContain('role="dialog"');
    expect(html).toContain('aria-modal="true"');
    expect(html).toContain('id="student-profile-title"');
    expect(html).toContain("Alisher Navoiy");
    expect(html).toContain("Faol a‘zo (Hozirgi sinf)");
    expect(html).toContain("IELTS Intensive B2");
    expect(html).toContain("Essay Writing Task 1");
    expect(html).toContain("Band 7.5");
    expect(html).toContain("Excellent cohesion and vocabulary variety.");
  });

  it("renders historical enrollment badge for former students", () => {
    const client = createClient();
    client.setQueryData(
      ["classroom-student-history", "teacher-1", "group-456", "student-123"],
      { ...sampleHistory, currentlyEnrolled: false },
    );

    const html = renderToStaticMarkup(
      <QueryClientProvider client={client}>
        <UnifiedStudentProfileModal
          groupId="group-456"
          studentId="student-123"
          userId="teacher-1"
          onClose={vi.fn()}
        />
      </QueryClientProvider>,
    );

    expect(html).toContain("Sobiq a‘zo (Tarixiy sinf)");
  });
});
