import { describe, expect, it, vi, beforeEach } from "vitest";
import { fetchMyAssignments, joinCohortByCode, fetchMyAttendance } from "./assignments";
import * as api from "./api";

vi.mock("./api", () => ({
  get: vi.fn(),
  post: vi.fn(),
}));

describe("assignments client", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("fetchMyAssignments returns array on success", async () => {
    const mockData = [
      {
        id: "asg-1",
        cohort_id: "cohort-1",
        cohort_name: "IELTS Intensive",
        title: "Week 1 Vocabulary",
        deadline: "2026-11-25T18:00:00Z",
        min_pass_percent: 80,
        is_submitted: false,
        score_percent: null,
        is_passed: false,
        is_overdue: false,
        status: "pending" as const,
      },
    ];
    vi.mocked(api.get).mockResolvedValueOnce(mockData);

    const result = await fetchMyAssignments();
    expect(api.get).toHaveBeenCalledWith("/v1/student/my-assignments");
    expect(result).toHaveLength(1);
    expect(result[0].title).toBe("Week 1 Vocabulary");
  });

  it("fetchMyAssignments gracefully falls back to empty array on network failure", async () => {
    vi.mocked(api.get).mockRejectedValueOnce(new Error("Network offline"));

    const result = await fetchMyAssignments();
    expect(result).toEqual([]);
  });

  it("joinCohortByCode trims and uppercases code", async () => {
    vi.mocked(api.post).mockResolvedValueOnce({ cohort_name: "Group Alpha" });

    const res = await joinCohortByCode("  bw-1234  ");
    expect(api.post).toHaveBeenCalledWith("/v1/student/join-cohort", {
      invite_code: "BW-1234",
    });
    expect(res.cohort_name).toBe("Group Alpha");
  });

  it("fetchMyAttendance passes month param if present", async () => {
    vi.mocked(api.get).mockResolvedValueOnce([{ date: "2026-11-18", state: "present" }]);

    const res = await fetchMyAttendance("2026-11");
    expect(api.get).toHaveBeenCalledWith("/v1/attendance", { month: "2026-11" });
    expect(res).toHaveLength(1);
  });
});
