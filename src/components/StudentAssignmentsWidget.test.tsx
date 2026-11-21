import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { StudentAssignmentsWidget } from "./StudentAssignmentsWidget";
import type { StudentAssignmentItem } from "@/lib/assignments";

vi.mock("@/lib/assignments", () => ({
  fetchMyAssignments: vi.fn(),
}));

function createClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
      },
    },
  });
}

const mockAssignments: StudentAssignmentItem[] = [
  {
    id: "assign-vocab-1",
    cohort_id: "cohort-1",
    cohort_name: "Group A",
    title: "Unit 5 Oxford 3000 Vocabulary",
    deadline: "2026-11-25T18:00:00Z",
    min_pass_percent: 80,
    is_submitted: false,
    score_percent: null,
    is_passed: false,
    is_overdue: false,
    status: "pending",
    vocabulary_set_id: "vocab-set-5",
    exam_id: null,
  },
  {
    id: "assign-exam-2",
    cohort_id: "cohort-1",
    cohort_name: "Group A",
    title: "IELTS Full Mock Test #1",
    deadline: "2026-11-26T20:00:00Z",
    min_pass_percent: 75,
    is_submitted: false,
    score_percent: null,
    is_passed: false,
    is_overdue: false,
    status: "pending",
    vocabulary_set_id: null,
    exam_id: "exam-mock-1",
    can_launch_exam: true,
  },
  {
    id: "assign-passed-3",
    cohort_id: "cohort-1",
    cohort_name: "Group A",
    title: "Grammar Diagnostic Quiz",
    deadline: "2026-11-18T12:00:00Z",
    min_pass_percent: 70,
    is_submitted: true,
    score_percent: 92,
    is_passed: true,
    is_overdue: false,
    status: "passed",
    vocabulary_set_id: null,
    exam_id: null,
  },
];

describe("StudentAssignmentsWidget", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders assignments header and tab controls with accurate counts", () => {
    const client = createClient();
    client.setQueryData(["my-assignments", "student-1"], mockAssignments);

    const html = renderToStaticMarkup(
      <QueryClientProvider client={client}>
        <StudentAssignmentsWidget
          userId="student-1"
          onNavigate={vi.fn()}
          onStartExam={vi.fn()}
          onSelectVocabulary={vi.fn()}
        />
      </QueryClientProvider>
    );

    expect(html).toContain("Sinf topshiriqlari va uy vazifalari");
    expect(html).toContain("2 ta faol topshiriq mavjud");
    expect(html).toContain("Faol (2)");
    expect(html).toContain("Barchasi (3)");
    expect(html).toContain("Tugallangan (1)");
  });

  it("renders active assignments with vocabulary and exam action buttons", () => {
    const client = createClient();
    client.setQueryData(["my-assignments", "student-1"], mockAssignments);

    const html = renderToStaticMarkup(
      <QueryClientProvider client={client}>
        <StudentAssignmentsWidget
          userId="student-1"
          onNavigate={vi.fn()}
          onStartExam={vi.fn()}
          onSelectVocabulary={vi.fn()}
        />
      </QueryClientProvider>
    );

    expect(html).toContain("Unit 5 Oxford 3000 Vocabulary");
    expect(html).toContain("Lug‘atni o‘rganish →");
    expect(html).toContain("IELTS Full Mock Test #1");
    expect(html).toContain("Imtihonni boshlash →");
  });

  it("renders empty state when there are no assignments", () => {
    const client = createClient();
    client.setQueryData(["my-assignments", "student-1"], []);

    const html = renderToStaticMarkup(
      <QueryClientProvider client={client}>
        <StudentAssignmentsWidget
          userId="student-1"
          onNavigate={vi.fn()}
          onStartExam={vi.fn()}
          onSelectVocabulary={vi.fn()}
        />
      </QueryClientProvider>
    );

    expect(html).toContain("Hozircha biriktirilgan vazifalar yo‘q");
    expect(html).toContain("Barcha topshiriqlar bajarilgan");
  });

  it("renders error state when fetch fails", () => {
    const client = createClient();
    client.setQueryDefaults(["my-assignments"], { enabled: false });
    const query = client.getQueryCache().build(client, {
      queryKey: ["my-assignments", "student-1"],
    });
    query.setState({
      status: "error",
      fetchStatus: "idle",
      error: new Error("Network offline"),
      dataUpdatedAt: Date.now(),
      errorUpdatedAt: Date.now(),
    });

    const html = renderToStaticMarkup(
      <QueryClientProvider client={client}>
        <StudentAssignmentsWidget
          userId="student-1"
          onNavigate={vi.fn()}
          onStartExam={vi.fn()}
          onSelectVocabulary={vi.fn()}
        />
      </QueryClientProvider>
    );

    expect(html).toContain("Topshiriqlarni yuklashda xatolik yuz berdi");
    expect(html).toContain("Qayta urinish");
  });
});
