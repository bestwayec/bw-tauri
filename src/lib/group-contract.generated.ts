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
}>;
  missedWords: Array<{
  english: string;
  count: number;
}>;
  overdueCount: number;
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
