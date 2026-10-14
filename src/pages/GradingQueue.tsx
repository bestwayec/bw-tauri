import { useState } from "react";

export interface SubmissionItem {
  id: string;
  studentName: string;
  studentPhone: string;
  examTitle: string;
  examType?: "IELTS" | "MULTILEVEL";
  skill: "writing" | "speaking";
  subType: string; // e.g. "Task 2 Essay" or "Part 2 Cue Card"
  submittedAt: string;
  status: "pending" | "graded";
  prompt: string;
  // Writing payload
  responseText?: string;
  // Speaking payload
  audioDurationSeconds?: number;
  audioUrl?: string;
  // Existing/draft scores
  criteriaScores: {
    c1: number; // TR or FC
    c2: number; // CC or LR
    c3: number; // LR or GRA
    c4: number; // GRA or PR
  };
  overallBand: number | null;
  teacherFeedback: string;
}

const INITIAL_SUBMISSIONS: SubmissionItem[] = [
  {
    id: "sub-w-01",
    studentName: "Azamat Karimov",
    studentPhone: "+998 90 123 45 67",
    examTitle: "IELTS Academic Mock 14",
    skill: "writing",
    subType: "Task 2 (Academic Essay)",
    submittedAt: "Today, 13:40",
    status: "pending",
    prompt:
      "Some people believe that artificial intelligence will replace teachers in classrooms in the future, while others argue that the human element is indispensable in education. Discuss both views and give your opinion.",
    responseText:
      "In contemporary society, the integration of artificial intelligence into educational settings has ignited contentious debate. While technological optimists contend that intelligent algorithms and machine tutors could completely substitute human educators, I staunchly maintain that educators provide irreplaceable pedagogical guidance and emotional empathy.\n\nOn one hand, artificial intelligence offers unparalleled efficiency in data processing and adaptive learning. Advanced algorithms can analyze a student's learning pace, pinpoint specific weaknesses in grammar or mathematics, and curate tailored practice exercises in milliseconds. For instance, algorithmic tutoring platforms in mathematics can provide instant step-by-step diagnostic feedback. Consequently, proponents argue that AI guarantees unbiased, scalable, and personalized education for pupils irrespective of geographical constraints.\n\nOn the other hand, the holistic development of learners necessitates human mentorship that cannot be replicated by silicon processors. Education extends far beyond rote memorization; it encompasses critical thinking, ethical reasoning, and interpersonal communication. A skilled teacher perceives subtle signs of frustration or disengagement, providing timely encouragement that sustains a pupil's intrinsic motivation. Furthermore, teachers cultivate collaboration and resolve conflict during group projects, serving as moral role models.\n\nIn conclusion, although artificial intelligence will undeniably augment instructional efficiency, it should serve as a sophisticated pedagogical assistant rather than a replacement. The human touch remains the cornerstone of inspiring and well-rounded education.",
    criteriaScores: { c1: 7.5, c2: 7.5, c3: 7.0, c4: 7.5 },
    overallBand: null,
    teacherFeedback:
      "Well structured essay with clear paragraphing and cohesive devices. Strong academic vocabulary (pedagogical guidance, contentious debate, tailored practice). Try to include more diverse complex sentence inversions.",
  },
  {
    id: "sub-s-02",
    studentName: "Madina Usmanova",
    studentPhone: "+998 93 456 78 90",
    examTitle: "IELTS Academic Mock 14",
    skill: "speaking",
    subType: "Part 2 (Cue Card)",
    submittedAt: "Today, 14:15",
    status: "pending",
    prompt:
      "Describe an important historic monument you visited that left a deep impression on you. You should say: where it was, why you visited it, what it looked like, and explain why it was memorable.",
    audioDurationSeconds: 118,
    audioUrl: "https://example.com/audio/mock-speaking-01.wav",
    criteriaScores: { c1: 7.0, c2: 7.0, c3: 6.5, c4: 7.0 },
    overallBand: null,
    teacherFeedback:
      "Fluent delivery with minimal hesitation. Pronunciation of historical terms like 'architecture' and 'mausoleum' was accurate. Work on reducing repetition of 'you know'.",
  },
  {
    id: "sub-w-03",
    studentName: "Javohir Tursunov",
    studentPhone: "+998 97 789 01 23",
    examTitle: "CEFR Multilevel B2/C1 Practice",
    examType: "MULTILEVEL",
    skill: "writing",
    subType: "Part 2 (Formal Letter)",
    submittedAt: "Yesterday, 16:30",
    status: "pending",
    prompt:
      "Write a letter to your local city council proposing a new green cycling path in your neighborhood. Explain the benefits to public health and traffic decongestion.",
    responseText:
      "Dear City Council Members,\n\nI am writing to respectfully submit a proposal regarding the development of a dedicated green cycling corridor connecting the Yunusabad residential district with the central transit terminal.\n\nAt present, our neighborhood experiences acute vehicular congestion during morning and evening rush hours, resulting in elevated carbon emissions and hazardous conditions for pedestrians. The construction of an eco-friendly cycling pathway would encourage active commuting, alleviate peak-hour traffic strain, and measurably boost community wellbeing.\n\nThank you for considering this constructive civic initiative. I would welcome the opportunity to discuss the feasibility study at your upcoming public hearing.\n\nYours sincerely,\nJavohir Tursunov",
    criteriaScores: { c1: 7.0, c2: 7.0, c3: 6.5, c4: 7.0 },
    overallBand: null,
    teacherFeedback: "Concise and formally polite. Good vocabulary.",
  },
  {
    id: "sub-s-04",
    studentName: "Zarina Alimova",
    studentPhone: "+998 99 234 56 78",
    examTitle: "IELTS Academic Mock 13",
    skill: "speaking",
    subType: "Part 3 (Discussion)",
    submittedAt: "Yesterday, 11:20",
    status: "graded",
    prompt: "How has technology changed the way cultural heritage is preserved?",
    audioDurationSeconds: 145,
    criteriaScores: { c1: 8.0, c2: 8.0, c3: 7.5, c4: 8.0 },
    overallBand: 8.0,
    teacherFeedback: "Superb articulation and wide lexical range with natural idiomatic phrasing.",
  },
];

export default function GradingQueue() {
  const [submissions, setSubmissions] = useState<SubmissionItem[]>(INITIAL_SUBMISSIONS);
  const [selectedId, setSelectedId] = useState<string>("sub-w-01");
  const [skillFilter, setSkillFilter] = useState<"all" | "writing" | "speaking">("all");
  const [statusFilter, setStatusFilter] = useState<"all" | "pending" | "graded">("pending");
  const [isPlaying, setIsPlaying] = useState(false);
  const [playProgress, setPlayProgress] = useState(25);
  const [playbackSpeed, setPlaybackSpeed] = useState<number>(1);
  const [toast, setToast] = useState<string | null>(null);

  const selected = submissions.find((s) => s.id === selectedId) ?? submissions[0];

  function triggerToast(msg: string) {
    setToast(msg);
    setTimeout(() => setToast(null), 3000);
  }

  function handleScoreChange(criterion: "c1" | "c2" | "c3" | "c4", val: number) {
    if (!selected) return;
    const updatedScores = { ...selected.criteriaScores, [criterion]: val };
    const avg =
      Math.round(
        ((updatedScores.c1 + updatedScores.c2 + updatedScores.c3 + updatedScores.c4) / 4) * 2
      ) / 2;
    setSubmissions((prev) =>
      prev.map((s) =>
        s.id === selected.id ? { ...s, criteriaScores: updatedScores, overallBand: avg } : s
      )
    );
  }

  function handleFeedbackChange(text: string) {
    if (!selected) return;
    setSubmissions((prev) =>
      prev.map((s) => (s.id === selected.id ? { ...s, teacherFeedback: text } : s))
    );
  }

  function handleSubmitGrade() {
    if (!selected) return;
    const avg =
      selected.overallBand ??
      Math.round(
        ((selected.criteriaScores.c1 +
          selected.criteriaScores.c2 +
          selected.criteriaScores.c3 +
          selected.criteriaScores.c4) /
          4) *
          2
      ) / 2;
    setSubmissions((prev) =>
      prev.map((s) =>
        s.id === selected.id ? { ...s, status: "graded", overallBand: avg } : s
      )
    );
    triggerToast(`Official grade submitted for ${selected.studentName}: Band ${avg}`);
  }

  const filtered = submissions.filter((s) => {
    const matchSkill = skillFilter === "all" || s.skill === skillFilter;
    const matchStatus = statusFilter === "all" || s.status === statusFilter;
    return matchSkill && matchStatus;
  });

  const wordCount = selected?.responseText ? selected.responseText.trim().split(/\s+/).length : 0;
  const currentBand =
    selected?.overallBand ??
    (selected
      ? Math.round(
          ((selected.criteriaScores.c1 +
            selected.criteriaScores.c2 +
            selected.criteriaScores.c3 +
            selected.criteriaScores.c4) /
            4) *
            2
        ) / 2
      : 0);

  return (
    <div className="space-y-6">
      {/* Toast */}
      {toast && (
        <div className="fixed right-6 top-6 z-50 flex items-center gap-3 rounded-2xl border border-emerald-500/40 bg-surface/95 px-5 py-3.5 text-sm font-medium text-emerald-300 shadow-2xl backdrop-blur-xl animate-rise">
          <span className="flex h-2.5 w-2.5 rounded-full bg-emerald-400 shadow-[0_0_8px_#10B981]" />
          {toast}
        </div>
      )}

      {/* Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-white">Grading Queue</h1>
          <p className="mt-1 text-xs text-white/50">
            Review student writing essays and listen to speaking audio recordings to assign official band scores.
          </p>
        </div>

        {/* Filter Bar */}
        <div className="flex flex-wrap items-center gap-2">
          {/* Skill selector */}
          <div className="flex items-center rounded-xl border border-white/10 bg-surface/80 p-1">
            {(["all", "writing", "speaking"] as const).map((sk) => (
              <button
                key={sk}
                type="button"
                onClick={() => setSkillFilter(sk)}
                className={`rounded-lg px-3 py-1.5 text-xs font-semibold capitalize transition ${
                  skillFilter === sk
                    ? "bg-emerald-500 text-white shadow-[0_0_12px_rgba(16,185,129,0.3)]"
                    : "text-white/60 hover:text-white"
                }`}
              >
                {sk}
              </button>
            ))}
          </div>

          {/* Status selector */}
          <div className="flex items-center rounded-xl border border-white/10 bg-surface/80 p-1">
            {(["pending", "graded", "all"] as const).map((st) => (
              <button
                key={st}
                type="button"
                onClick={() => setStatusFilter(st)}
                className={`rounded-lg px-3 py-1.5 text-xs font-semibold capitalize transition ${
                  statusFilter === st
                    ? "bg-white/15 text-white"
                    : "text-white/50 hover:text-white"
                }`}
              >
                {st}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Workspace: 2 Columns */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
        {/* Left column: Submissions List */}
        <div className="space-y-3 lg:col-span-4">
          <p className="text-xs font-semibold uppercase tracking-wider text-white/40">
            Submissions ({filtered.length})
          </p>
          <div className="space-y-2.5">
            {filtered.map((item) => {
              const active = item.id === selected?.id;
              const isWriting = item.skill === "writing";
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setSelectedId(item.id)}
                  className={`w-full text-left rounded-2xl border p-4 transition duration-150 ${
                    active
                      ? "border-emerald-500/50 bg-emerald-500/10 shadow-[0_0_24px_rgba(16,185,129,0.15)]"
                      : "border-white/10 bg-surface hover:border-white/20 hover:bg-surface-hover"
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <span className="font-semibold text-white">{item.studentName}</span>
                    <span
                      className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ${
                        item.status === "graded"
                          ? "bg-emerald-500/20 text-emerald-300"
                          : "bg-amber-500/20 text-amber-300"
                      }`}
                    >
                      {item.status === "graded" ? `Band ${item.overallBand}` : "Pending"}
                    </span>
                  </div>
                  <div className="mt-2 flex items-center gap-2 text-xs text-white/60">
                    <span className={`inline-flex items-center gap-1 font-medium ${isWriting ? "text-cyan-400" : "text-purple-400"}`}>
                      {isWriting ? "✍️ Writing" : "🎙️ Speaking"}
                    </span>
                    <span>·</span>
                    <span className="truncate">{item.subType}</span>
                  </div>
                  <div className="mt-2 flex items-center justify-between text-[11px] text-white/40">
                    <span>{item.examTitle}</span>
                    <span>{item.submittedAt}</span>
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        {/* Right column: Active Grading Detail */}
        {selected ? (
          <div className="space-y-6 lg:col-span-8">
            {/* Top overview card */}
            <div className="card rounded-2xl border border-white/10 p-5">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <div className="flex items-center gap-2.5">
                    <h2 className="text-xl font-bold text-white">{selected.studentName}</h2>
                    <span className="rounded-lg bg-emerald-500/15 px-2.5 py-0.5 text-xs font-bold text-emerald-400">
                      {selected.skill.toUpperCase()}
                    </span>
                  </div>
                  <p className="mt-1 text-xs text-white/50">{selected.examTitle} · {selected.subType} · {selected.studentPhone}</p>
                </div>

                <div className="flex items-center gap-4">
                  <div className="text-right">
                    <p className="text-[10px] font-semibold uppercase tracking-wider text-white/40">Target Band</p>
                    <p className="text-2xl font-black text-emerald-400">
                      {currentBand > 0 ? currentBand.toFixed(1) : "—"}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={handleSubmitGrade}
                    className="btn-brand px-5 py-2.5 text-xs font-bold shadow-lg"
                  >
                    Submit Official Score
                  </button>
                </div>
              </div>

              {/* Prompt box */}
              <div className="mt-4 rounded-xl border border-white/10 bg-black/30 p-4">
                <p className="text-[11px] font-semibold uppercase tracking-wider text-white/40">Exam Prompt & Instructions</p>
                <p className="mt-1.5 text-xs leading-relaxed text-white/90">{selected.prompt}</p>
              </div>
            </div>

            {/* Content area: Writing essay OR Speaking player */}
            {selected.skill === "writing" ? (
              <div className="card rounded-2xl border border-white/10 p-5">
                <div className="flex items-center justify-between border-b border-white/10 pb-3">
                  <h3 className="font-semibold text-white">Student Essay Submission</h3>
                  <div className="flex items-center gap-3 text-xs text-white/50">
                    <span>Word Count: <strong className="text-emerald-400">{wordCount} words</strong></span>
                    <span>·</span>
                    <span>Min Recommended: 250 words</span>
                  </div>
                </div>
                <div className="mt-4 max-h-80 overflow-y-auto whitespace-pre-wrap rounded-xl border border-white/5 bg-black/20 p-4 font-mono text-xs leading-relaxed text-white/80">
                  {selected.responseText}
                </div>
              </div>
            ) : (
              <div className="card rounded-2xl border border-white/10 p-5">
                <div className="flex items-center justify-between border-b border-white/10 pb-3">
                  <h3 className="font-semibold text-white">Student Speaking Audio Recording</h3>
                  <span className="text-xs text-white/50">
                    Duration: <strong className="text-emerald-400">{selected.audioDurationSeconds} seconds</strong>
                  </span>
                </div>

                {/* Audio player UI */}
                <div className="mt-5 space-y-4 rounded-xl border border-white/10 bg-black/30 p-5">
                  {/* Waveform graphic */}
                  <div className="flex h-12 items-end justify-between gap-1 px-2">
                    {[40, 65, 80, 45, 90, 70, 30, 85, 95, 60, 40, 80, 100, 75, 50, 90, 65, 45, 85, 60, 30, 70, 85, 40, 90, 60, 45].map(
                      (h, i) => (
                        <div
                          key={i}
                          className={`w-full rounded-full transition-all duration-300 ${
                            i < (playProgress / 100) * 27 ? "bg-emerald-400" : "bg-white/20"
                          }`}
                          style={{ height: `${h}%` }}
                        />
                      )
                    )}
                  </div>

                  {/* Scrubber progress */}
                  <input
                    type="range"
                    min={0}
                    max={100}
                    value={playProgress}
                    onChange={(e) => setPlayProgress(Number(e.target.value))}
                    className="exam-range w-full"
                  />

                  {/* Controls */}
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <button
                        type="button"
                        onClick={() => setIsPlaying((p) => !p)}
                        className="grid h-10 w-10 place-items-center rounded-xl bg-emerald-500 font-bold text-black shadow-[0_0_16px_rgba(16,185,129,0.4)] hover:bg-emerald-400"
                      >
                        {isPlaying ? "❚❚" : "▶"}
                      </button>
                      <span className="font-mono text-xs text-white/70">
                        0:{Math.floor((playProgress / 100) * (selected.audioDurationSeconds ?? 120)).toString().padStart(2, "0")} / 0:{selected.audioDurationSeconds ?? 120}
                      </span>
                    </div>

                    {/* Speed options */}
                    <div className="flex items-center gap-1 rounded-lg border border-white/10 bg-white/5 p-1">
                      {[0.75, 1, 1.25, 1.5].map((spd) => (
                        <button
                          key={spd}
                          type="button"
                          onClick={() => setPlaybackSpeed(spd)}
                          className={`rounded px-2 py-1 text-[11px] font-semibold ${
                            playbackSpeed === spd ? "bg-emerald-500/20 text-emerald-300" : "text-white/50 hover:text-white"
                          }`}
                        >
                          {spd}x
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* Rubric Criteria Sliders */}
            <div className="card rounded-2xl border border-white/10 p-5">
              <h3 className="font-semibold text-white">IELTS / CEFR Official Band Scoring Rubric</h3>
              <p className="mt-1 text-xs text-white/50">Adjust criteria scores from 0.0 to 9.0 (0.5 increments).</p>

              <div className="mt-5 grid grid-cols-1 gap-4 sm:grid-cols-2">
                {[
                  {
                    key: "c1" as const,
                    label: selected.skill === "writing" ? "Task Achievement / Response" : "Fluency & Coherence",
                    val: selected.criteriaScores.c1,
                  },
                  {
                    key: "c2" as const,
                    label: selected.skill === "writing" ? "Coherence & Cohesion" : "Lexical Resource",
                    val: selected.criteriaScores.c2,
                  },
                  {
                    key: "c3" as const,
                    label: selected.skill === "writing" ? "Lexical Resource" : "Grammatical Range",
                    val: selected.criteriaScores.c3,
                  },
                  {
                    key: "c4" as const,
                    label: selected.skill === "writing" ? "Grammatical Range & Accuracy" : "Pronunciation",
                    val: selected.criteriaScores.c4,
                  },
                ].map((crit) => (
                  <div key={crit.key} className="rounded-xl border border-white/5 bg-black/20 p-3.5">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-medium text-white/80">{crit.label}</span>
                      <span className="rounded bg-emerald-500/10 px-2 py-0.5 font-mono text-xs font-bold text-emerald-400">
                        {crit.val.toFixed(1)}
                      </span>
                    </div>
                    <input
                      type="range"
                      min={1}
                      max={9}
                      step={0.5}
                      value={crit.val}
                      onChange={(e) => handleScoreChange(crit.key, parseFloat(e.target.value))}
                      className="exam-range mt-3 w-full"
                    />
                    <div className="mt-1 flex justify-between text-[10px] text-white/30 font-mono">
                      <span>4.0</span>
                      <span>5.5</span>
                      <span>7.0</span>
                      <span>9.0</span>
                    </div>
                  </div>
                ))}
              </div>

              {/* Feedback text */}
              <div className="mt-5 space-y-2">
                <label className="text-xs font-medium uppercase tracking-wider text-white/40">
                  Examiner Feedback & Explanatory Remarks
                </label>
                <textarea
                  rows={3}
                  value={selected.teacherFeedback}
                  onChange={(e) => handleFeedbackChange(e.target.value)}
                  placeholder="Provide targeted feedback highlighting strengths and key improvement areas for the student..."
                  className="w-full rounded-xl border border-white/10 bg-black/25 p-3 text-xs text-white placeholder-white/30 focus:border-emerald-500 focus:outline-none"
                />
              </div>
            </div>
          </div>
        ) : (
          <div className="card rounded-2xl p-12 text-center text-white/50 lg:col-span-8">
            <p className="text-base font-semibold text-white">No submissions found</p>
          </div>
        )}
      </div>
    </div>
  );
}
