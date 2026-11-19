// Generated from Bestway docs/contracts/groups.v1.openapi.json.

export type WeekDay = "mon" | "tue" | "wed" | "thu" | "fri" | "sat" | "sun";

export type ScheduleItem = {
  day: WeekDay;
  startTime: string;
  endTime: string;
};

export type GroupInput = {
  name: string;
  teacherId?: string | null;
  schedule?: Array<ScheduleItem>;
};

export type GroupListItem = {
  id: string;
  name: string;
  teacherId: string | null;
  teacherName: string | null;
  schedule: Array<ScheduleItem> | null;
  createdAt: string;
  studentsCount: number;
};

export type GroupStudent = {
  studentId: string;
  name: string;
  phone?: string;
  isActive: boolean;
  isApproved: boolean;
  currentPoints: number;
  completedExamsCount: number;
  listeningScore: number | null;
  readingScore: number | null;
  writingScore: number | null;
  speakingScore: number | null;
  overallBand: number | null;
};

export type GroupAnalytics = {
  averageBandScore: number | null;
  totalCompletedAttempts: number;
};

export type GroupDetail = {
  id: string;
  name: string;
  teacherId: string | null;
  teacherName: string | null;
  schedule: Array<ScheduleItem> | null;
  createdAt: string;
  students: Array<GroupStudent>;
  analytics: GroupAnalytics;
};

export type ApiFailure = {
  success: false;
  error: {
  code: string;
  message: string;
};
};

export type ClassroomAssignment = {
  id: string;
  cohort_id: string;
  cohort_name: string;
  title: string;
  deadline: string;
  min_pass_percent: number;
  created_at: string;
  lesson_id: string | null;
  lesson_title: string | null;
  exam_id: string | null;
  exam_title: string | null;
};

export type ClassroomAssignmentInput = {
  title: string;
  deadline?: string;
  min_pass_percent?: number;
  lesson_id?: string;
  exam_id?: string;
};
