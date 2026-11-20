import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import TeacherDashboard from "./TeacherDashboard";

vi.mock("@/lib/api", () => ({
  get: vi.fn(),
  post: vi.fn(),
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

describe("TeacherDashboard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders teacher greeting and structural dashboard sections", () => {
    const client = createClient();
    const html = renderToStaticMarkup(
      <QueryClientProvider client={client}>
        <TeacherDashboard teacherName="Komiljon" userId="teacher-1" onNavigate={vi.fn()} />
      </QueryClientProvider>
    );

    expect(html).toContain("Teacher Command Center");
    expect(html).toContain("Komiljon");
    expect(html).toContain("Faol Sinflar");
    expect(html).toContain("Jami O‘quvchilar");
    expect(html).toContain("Tekshirish Navbati");
    expect(html).toContain("Lug‘at Studiyasi");
    expect(html).toContain("Mening Sinflarim");
    expect(html).toContain("Tekshirish navbati");
  });

  it("renders error state when groups query has error and does not fabricate numbers", () => {
    const client = createClient();
    client.setQueryDefaults(["groups"], { enabled: false });
    const query = client.getQueryCache().build(client, {
      queryKey: ["groups", "teacher-1", false, ""],
    });
    query.setState({
      status: "error",
      fetchStatus: "idle",
      error: new Error("Network failure"),
      dataUpdatedAt: Date.now(),
      errorUpdatedAt: Date.now(),
    });

    const html = renderToStaticMarkup(
      <QueryClientProvider client={client}>
        <TeacherDashboard teacherName="Komiljon" userId="teacher-1" onNavigate={vi.fn()} />
      </QueryClientProvider>
    );

    expect(html).toContain("Guruhlarni yuklashda xatolik yuz berdi");
    expect(html).toContain("Yuklab bo‘lmadi · Qayta urinish ⟳");
  });

  it("renders error state when grading queue query has error and does not fabricate 0", () => {
    const client = createClient();
    client.setQueryDefaults(["teacher-submissions"], { enabled: false });
    const query = client.getQueryCache().build(client, {
      queryKey: ["teacher-submissions", "teacher-1"],
    });
    query.setState({
      status: "error",
      fetchStatus: "idle",
      error: new Error("Grading server 500"),
      dataUpdatedAt: Date.now(),
      errorUpdatedAt: Date.now(),
    });

    const html = renderToStaticMarkup(
      <QueryClientProvider client={client}>
        <TeacherDashboard teacherName="Komiljon" userId="teacher-1" onNavigate={vi.fn()} />
      </QueryClientProvider>
    );

    expect(html).toContain("Tekshirish navbatini yuklashda xatolik yuz berdi");
    expect(html).toContain("Xatolik · Qayta urinish ⟳");
  });

  it("renders real counts when data is pre-populated and never fabricates statistics", () => {
    const client = createClient();
    client.setQueryData(["groups", "teacher-1", false, ""], [
      {
        id: "grp-1",
        name: "Morning IELTS",
        teacherId: "teacher-1",
        teacherName: "Komiljon",
        schedule: null,
        createdAt: "2026-11-01T00:00:00Z",
        studentsCount: 15,
      },
    ]);
    client.setQueryData(["teacher-submissions", "teacher-1"], { total: 71, items: [
      {
        id: "sub-1",
        studentName: "Ali Valiyev",
        questionId: "question-1",
        examTitle: "IELTS Simulation",
        skill: "writing",
        subType: "Task 2",
        submittedAt: "2026-11-19T10:00:00Z",
        status: "pending",
        prompt: "Essay prompt",
        criteriaScores: { c1: 0, c2: 0, c3: 0, c4: 0 },
        overallBand: null,
        teacherFeedback: "",
      },
    ] });

    const html = renderToStaticMarkup(
      <QueryClientProvider client={client}>
        <TeacherDashboard teacherName="Komiljon" userId="teacher-1" onNavigate={vi.fn()} />
      </QueryClientProvider>
    );

    expect(html).toContain("Morning IELTS");
    expect(html).toContain("Ali Valiyev");
    expect(html).toContain("15 o‘quvchi");
    expect(html).toContain("71 ta");
  });
});
