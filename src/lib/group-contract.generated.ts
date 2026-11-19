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
  archived?: boolean;
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
  vocabulary_set_id: string | null;
};

export type ClassroomAssignmentInput = {
  title: string;
  deadline?: string;
  min_pass_percent?: number;
  lesson_id?: string;
  exam_id?: string;
  vocabulary_set_id?: string;
};

export type VocabularyMode = "mixed" | "spelling" | "eng_uzb" | "uzb_eng";

export type VocabularyCard = {
  id: string;
  english: string;
  uzbek: string;
  contextSentence: string | null;
  partOfSpeech: string | null;
  definition?: string;
  synonyms?: Array<string>;
  level?: string;
  pronunciation?: string;
  audioUrl?: string;
};

export type VocabularyQuestion = {
  id: string;
  wordId: string;
  prompt: string;
  type: "spelling" | "eng_uzb" | "uzb_eng";
  options: Array<string>;
};

export type VocabularyResult = {
  score: number;
  totalWords: number;
  percentage: number;
  pointsAwarded: number;
  mode: string;
  wrongAnswers: Array<{
  wordId: string;
  english: string;
  uzbek: string;
  userAnswer: string;
  correctAnswer: string;
}>;
  isPassed?: boolean;
};

export type VocabularySession = {
  sessionId: string;
  mode: VocabularyMode;
  result: VocabularyResult | null;
  questions: Array<VocabularyQuestion>;
};

export type VocabularyReview = {
  sessionId?: string;
  totalQuestions: number;
  questions: Array<VocabularyQuestion>;
};

export type VocabularyAssignmentReports = {
  assignedCount: number;
  completedCount: number;
  students: Array<{
  studentId: string;
  name: string;
  score: number;
  totalWords: number;
  percentage: number;
  isPassed: boolean;
  currentlyEnrolled: boolean;
}>;
  missedWords: Array<{
  english: string;
  count: number;
}>;
  overdueCount: number;
  page: number;
  hasNext: boolean;
  overdueStudents: Array<{
  studentId: string;
  name: string;
  currentlyEnrolled: boolean;
}>;
};

export type ClassroomVocabularyCollection = {
  id: string;
  title: string;
  wordCount: number;
};

export type VocabularySubmission = {
  sessionId: string;
  answers: Array<{
  wordId: string;
  answer: string;
}>;
};

export type BestwayRole = "student" | "teacher" | "parent" | "admin" | "super_admin";

export type RosterMemberInput = {
  studentId: string;
};

export type RosterMemberAdded = {
  groupId: string;
  studentId: string;
  added: boolean;
};

export type RosterMemberRemoved = {
  removed: boolean;
};

export type AttendanceMark = "present" | "absent" | "late";

export type ClassroomAttendanceRow = {
  studentId: string;
  date: string;
  state: AttendanceMark;
};

export type ClassroomAttendanceInput = {
  groupId: string;
  date: string;
  records: Array<{
  studentId: string;
  state: "present" | "absent" | "late" | "blank" | "empty";
}>;
};

export type ClassroomAttendanceSaved = {
  updated: number;
  cleared: number;
};

export type StandaloneVocabularyQuiz = {
  sessionId: string;
  setId: string;
  setTitle: string;
  level: string;
  mode: VocabularyMode;
  totalQuestions: number;
  questions: Array<VocabularyQuestion>;
};

export type StandaloneVocabularySubmission = {
  sessionId?: string;
  mode?: VocabularyMode;
  answers: Array<{
  wordId: string;
  answer: string;
  type?: string;
}>;
};

export type ClassroomArchiveState = {
  archived: boolean;
};

export type ClassroomBulkMembership = {
  action: "add" | "remove";
  studentIds: Array<string>;
};

export type ClassroomHistoryPage = {
  members: Array<{
  id: string;
  name: string;
  currentlyEnrolled: boolean;
}>;
  page: number;
  hasNext: boolean;
};

export type ClassroomStudentHistory = {
  studentId: string;
  name: string | null;
  groupId: string;
  groupName: string;
  currentlyEnrolled: boolean;
  membership: Array<{
  startedAt: string | null;
  endedAt: string | null;
}>;
  attendance: Array<{
  date: string;
  state: AttendanceMark;
}>;
  homework: Array<{
  assignment_id: string;
  assignment__title: string;
  assignment__vocabulary_set_id: string | null;
  status: string;
  score_percent: number;
  is_passed: boolean;
  completed_at: string;
}>;
  mockExams: Array<{
  id: string;
  exam__title: string;
  started_at: string;
  overall_band: number | null;
  overall_score: number | null;
}>;
  tests: Array<{
  id: string;
  test__title: string;
  started_at: string;
  total_score: number | null;
}>;
  feedback: Array<{
  attempt_id: string;
  skill: string;
  approved_feedback: unknown;
  feedback_text?: string;
  final_score: number | null;
}>;
};

export type VocabularyCollectionWordInput = {
  id?: string;
  english: string;
  uzbek: string;
  contextSentence?: string | null;
  partOfSpeech?: string | null;
  definition?: string;
  synonyms?: Array<string>;
  level?: string;
  pronunciation?: string;
  audioUrl?: string;
};

export type VocabularyCollection = {
  id: string;
  revision: number;
  title: string;
  description: string | null;
  isPublic: boolean;
  level: string;
  words: Array<VocabularyCard>;
};

export type VocabularyCollectionEdit = {
  revision: number;
  title?: string;
  description?: string;
  isPublic?: boolean;
  level?: string;
  words?: Array<VocabularyCollectionWordInput>;
};

export type VocabularyFlashcards = {
  lastWordId: string;
  familiarity: Record<string, "known" | "practice">;
  order: Array<string>;
  lastStudiedAt: string | null;
};

export type VocabularyFlashcardChange = {
  lastWordId?: string;
  wordId?: string;
  status?: "known" | "practice";
  order?: Array<string>;
};

export type VocabularyReviewHistory = {
  page: number;
  hasNext: boolean;
  entries: Array<{
  id: number;
  review__word__english: string;
  reviewed_at: string;
  next_review_at: string;
  correct: boolean;
  interval_days: number;
  mastered: boolean;
}>;
};

export type VocabularyLearnerHistory = {
  page: number;
  hasNext: boolean;
  entries: Array<{
  assignment_id: string;
  assignment__title: string;
  score_percent: number;
  completed_at: string;
  is_passed: boolean;
}>;
};
