/**
 * Student workspace: Assignments, Cohorts, and Attendance API client.
 * Connects directly to authenticated Django /v1 endpoints.
 */
import { get, post } from "./api";

export interface StudentAssignmentItem {
  id: string;
  cohort_id: string;
  cohort_name: string;
  teacher_name?: string;
  title: string;
  lesson_id?: string | null;
  lesson_title?: string | null;
  lesson_order?: number | null;
  exam_id?: string | null;
  exam_title?: string | null;
  can_launch_exam?: boolean;
  vocabulary_set_id?: string | null;
  deadline: string;
  min_pass_percent: number;
  is_submitted: boolean;
  score_percent: number | null;
  is_passed: boolean;
  is_overdue: boolean;
  status: "passed" | "failed" | "pending" | "overdue" | "awaiting_review" | "awaiting_result";
  completed_at?: string | null;
}

export interface StudentAttendanceItem {
  studentId: string;
  date: string;
  state: "present" | "absent" | "late";
}

export async function fetchMyAssignments(): Promise<StudentAssignmentItem[]> {
  const data = await get<StudentAssignmentItem[]>("/v1/student/my-assignments");
  if (!Array.isArray(data)) throw new Error("Invalid assignment list");
  return data;
}

export async function joinCohortByCode(code: string): Promise<{ cohort_name: string }> {
  return post<{ cohort_name: string }>("/v1/student/join-cohort", {
    invite_code: code.trim().toUpperCase(),
  });
}

export async function fetchMyAttendance(month?: string): Promise<StudentAttendanceItem[]> {
  const data = await get<StudentAttendanceItem[]>("/v1/attendance", month ? { month } : undefined);
  return Array.isArray(data) ? data : [];
}
