import { useState, useMemo } from "react";
import { useAssessmentOverview } from "@/lib/assessment-overview";

export interface StudentResultRow {
  id: string;
  studentId: string;
  studentName: string;
  studentPhone: string;
  examTitle: string;
  program: "IELTS" | "MULTILEVEL";
  date: string;
  listening: number;
  reading: number;
  writing: number;
  speaking: number;
  overallBand: number;
  cefrLevel: string;
  cheatFlagsCount: number;
  status: "certified" | "scored" | "flagged";
}

const RESULTS_DATA: StudentResultRow[] = [
  {
    id: "res-01",
    studentId: "BW-9801",
    studentName: "Azamat Karimov",
    studentPhone: "+998 90 123 45 67",
    examTitle: "IELTS Academic Full Mock 14",
    program: "IELTS",
    date: "2026-10-12 14:30",
    listening: 7.5,
    reading: 7.0,
    writing: 7.0,
    speaking: 7.5,
    overallBand: 7.5,
    cefrLevel: "C1",
    cheatFlagsCount: 3,
    status: "flagged",
  },
  {
    id: "res-02",
    studentId: "BW-9802",
    studentName: "Madina Usmanova",
    studentPhone: "+998 93 456 78 90",
    examTitle: "IELTS Academic Full Mock 14",
    program: "IELTS",
    date: "2026-10-12 14:45",
    listening: 8.5,
    reading: 8.0,
    writing: 7.5,
    speaking: 8.0,
    overallBand: 8.0,
    cefrLevel: "C1",
    cheatFlagsCount: 0,
    status: "certified",
  },
  {
    id: "res-03",
    studentId: "BW-9803",
    studentName: "Javohir Tursunov",
    studentPhone: "+998 97 789 01 23",
    examTitle: "CEFR Multilevel Standard Exam 08",
    program: "MULTILEVEL",
    date: "2026-10-11 16:20",
    listening: 68,
    reading: 64,
    writing: 62,
    speaking: 66,
    overallBand: 65,
    cefrLevel: "B2",
    cheatFlagsCount: 8,
    status: "flagged",
  },
  {
    id: "res-04",
    studentId: "BW-9804",
    studentName: "Zarina Alimova",
    studentPhone: "+998 99 234 56 78",
    examTitle: "IELTS Academic Full Mock 13",
    program: "IELTS",
    date: "2026-10-10 11:15",
    listening: 6.5,
    reading: 6.0,
    writing: 6.0,
    speaking: 6.5,
    overallBand: 6.5,
    cefrLevel: "B2",
    cheatFlagsCount: 0,
    status: "certified",
  },
  {
    id: "res-05",
    studentId: "BW-9805",
    studentName: "Sherzod Rakhimov",
    studentPhone: "+998 91 345 67 89",
    examTitle: "CEFR Multilevel Standard Exam 08",
    program: "MULTILEVEL",
    date: "2026-10-11 17:00",
    listening: 72,
    reading: 70,
    writing: 65,
    speaking: 68,
    overallBand: 69,
    cefrLevel: "C1",
    cheatFlagsCount: 1,
    status: "certified",
  },
  {
    id: "res-06",
    studentId: "BW-9806",
    studentName: "Dilorom Boboeva",
    studentPhone: "+998 90 987 65 43",
    examTitle: "IELTS General Training Mock 05",
    program: "IELTS",
    date: "2026-10-09 13:00",
    listening: 7.0,
    reading: 7.0,
    writing: 6.5,
    speaking: 7.0,
    overallBand: 7.0,
    cefrLevel: "C1",
    cheatFlagsCount: 0,
    status: "certified",
  },
  {
    id: "res-07",
    studentId: "BW-9807",
    studentName: "Bekzod Shukurov",
    studentPhone: "+998 91 876 54 32",
    examTitle: "IELTS Academic Full Mock 14",
    program: "IELTS",
    date: "2026-10-12 15:10",
    listening: 7.5,
    reading: 7.5,
    writing: 6.5,
    speaking: 7.5,
    overallBand: 7.5,
    cefrLevel: "C1",
    cheatFlagsCount: 0,
    status: "certified",
  },
  {
    id: "res-08",
    studentId: "BW-9808",
    studentName: "Kamola Yuldasheva",
    studentPhone: "+998 94 321 09 87",
    examTitle: "IELTS Academic Full Mock 14",
    program: "IELTS",
    date: "2026-10-12 15:30",
    listening: 6.0,
    reading: 6.0,
    writing: 5.5,
    speaking: 6.0,
    overallBand: 6.0,
    cefrLevel: "B2",
    cheatFlagsCount: 0,
    status: "certified",
  },
];

export default function StudentResults() {
  const [results] = useState<StudentResultRow[]>(RESULTS_DATA);
  const [search, setSearch] = useState("");
  const [programFilter, setProgramFilter] = useState<"all" | "IELTS" | "MULTILEVEL">("all");
  const [cheatFilter, setCheatFilter] = useState<"all" | "clean" | "flagged">("all");
  const [selectedStudent, setSelectedStudent] = useState<StudentResultRow | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const overviewQuery = useAssessmentOverview();
  const prediction = overviewQuery.data?.prediction;

  function triggerToast(msg: string) {
    setToast(msg);
    setTimeout(() => setToast(null), 3000);
  }

  function handleExportCSV() {
    const header = "Student ID,Name,Phone,Exam,Program,Date,L,R,W,S,Overall,CEFR,Cheating Flags\n";
    const rows = filtered
      .map(
        (r) =>
          `"${r.studentId}","${r.studentName}","${r.studentPhone}","${r.examTitle}","${r.program}","${r.date}",${r.listening},${r.reading},${r.writing},${r.speaking},${r.overallBand},"${r.cefrLevel}",${r.cheatFlagsCount}`
      )
      .join("\n");
    const blob = new Blob([header + rows], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.setAttribute("download", `bestway-exam-results-${Date.now()}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    triggerToast("Center results exported to CSV.");
  }

  const filtered = useMemo(() => {
    return results.filter((r) => {
      const matchSearch =
        r.studentName.toLowerCase().includes(search.toLowerCase()) ||
        r.studentId.toLowerCase().includes(search.toLowerCase()) ||
        r.studentPhone.toLowerCase().includes(search.toLowerCase()) ||
        r.examTitle.toLowerCase().includes(search.toLowerCase());
      const matchProg = programFilter === "all" || r.program === programFilter;
      const matchCheat =
        cheatFilter === "all" ||
        (cheatFilter === "clean" && r.cheatFlagsCount === 0) ||
        (cheatFilter === "flagged" && r.cheatFlagsCount > 0);
      return matchSearch && matchProg && matchCheat;
    });
  }, [results, search, programFilter, cheatFilter]);

  const stats = useMemo(() => {
    const total = results.length;
    const ieltsList = results.filter((r) => r.program === "IELTS");
    const avgIelts =
      ieltsList.length > 0
        ? (ieltsList.reduce((acc, r) => acc + r.overallBand, 0) / ieltsList.length).toFixed(1)
        : "—";
    const flaggedCount = results.filter((r) => r.cheatFlagsCount > 0).length;
    const highDistinction = ieltsList.filter((r) => r.overallBand >= 7.5).length;
    return { total, avgIelts, flaggedCount, highDistinction };
  }, [results]);

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
          <h1 className="text-2xl font-bold tracking-tight text-white">Student Scores & Results Registry</h1>
          <p className="mt-1 text-xs text-white/50">
            Center-wide database of candidate test scores, sub-section bands, and proctoring integrity records.
          </p>
        </div>

        <button
          type="button"
          onClick={handleExportCSV}
          className="flex items-center gap-2 rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-2.5 text-xs font-bold text-emerald-300 transition hover:bg-emerald-500/20"
        >
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
          </svg>
          Export CSV ({filtered.length})
        </button>
      </div>

      {/* KPI Banner */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <div className="card rounded-2xl p-4">
          <p className="text-xs font-medium uppercase tracking-wider text-white/40">Total Records</p>
          <p className="mt-2 text-3xl font-extrabold text-white">{stats.total}</p>
          <p className="mt-2 text-[11px] text-white/45">Certified exam records</p>
        </div>

        <div className="card rounded-2xl p-4">
          <p className="text-xs font-medium uppercase tracking-wider text-white/40">IELTS Center Avg</p>
          <p className="mt-2 text-3xl font-extrabold text-emerald-400">Band {stats.avgIelts}</p>
          <p className="mt-2 text-[11px] text-emerald-400/80">Benchmark: Band 6.5</p>
        </div>

        <div className="card rounded-2xl p-4">
          <p className="text-xs font-medium uppercase tracking-wider text-white/40">High Band (7.5+)</p>
          <p className="mt-2 text-3xl font-extrabold text-[#89F336]">{stats.highDistinction}</p>
          <p className="mt-2 text-[11px] text-white/45">Candidates with Band 7.5+</p>
        </div>

        <div className="card rounded-2xl p-4">
          <p className="text-xs font-medium uppercase tracking-wider text-white/40">Integrity Flags</p>
          <p className="mt-2 text-3xl font-extrabold text-amber-400">{stats.flaggedCount}</p>
          <p className="mt-2 text-[11px] text-amber-300/80">Require review before cert</p>
        </div>
      </div>

      {/* Universal Assessment Overview Banner */}
      <div className="card rounded-2xl border border-emerald-500/30 bg-gradient-to-br from-emerald-500/10 via-surface to-surface/90 p-5 shadow-lg">
        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-white/10 pb-4">
          <div>
            <div className="flex items-center gap-2">
              <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-500/35 bg-emerald-500/15 px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-emerald-300">
                Universal Assessment Overview
              </span>
              <span className="rounded-full border border-emerald-500/40 bg-emerald-500/20 px-2.5 py-0.5 font-mono text-[11px] font-extrabold text-emerald-300">
                CEFR {prediction?.multilevel?.cefrLevel ?? prediction?.ielts?.cefrLevel ?? "C1"}
              </span>
            </div>
            <h2 className="mt-1.5 text-lg font-bold text-white">
              Center-Wide Candidate Score Prediction & Diagnostics
            </h2>
            <p className="text-xs text-white/50">
              Dual-scale dynamic calibration: IELTS Band (0–9.0) and Multi-Level (0–75 ball).
            </p>
          </div>

          <div className="flex items-center gap-3">
            <div className="rounded-xl border border-sky-500/30 bg-sky-500/10 px-4 py-2 text-center">
              <p className="text-[10px] font-bold uppercase tracking-wider text-sky-300">IELTS Band</p>
              <p className="text-xl font-black text-white">
                Band {(prediction?.ielts?.predictedBand ?? (stats.avgIelts !== "—" ? Number(stats.avgIelts) : 7.0)).toFixed(1)}
              </p>
            </div>
            <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-2 text-center">
              <p className="text-[10px] font-bold uppercase tracking-wider text-emerald-300">Multi-Level</p>
              <p className="text-xl font-black text-emerald-400">
                {prediction?.multilevel?.predictedScore ?? 62} / 75 pts
              </p>
            </div>
          </div>
        </div>

        {/* Weak Modules Diagnostic */}
        <div className="mt-4">
          <p className="text-xs font-bold text-white/80">Priority Weak Modules (Attention Areas)</p>
          <div className="mt-2.5 grid gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
            {(prediction?.weakModules?.length
              ? prediction.weakModules.slice(0, 3)
              : [
                  {
                    module: "Reading — Matching Headings",
                    skill: "reading",
                    accuracyPercent: 42,
                    recommendation: "Focus on skimming topic sentences before matching options.",
                    severity: "high" as const,
                  },
                  {
                    module: "Listening — Part 3 Multiple Choice",
                    skill: "listening",
                    accuracyPercent: 55,
                    recommendation: "Track speaker agreement and negation indicators.",
                    severity: "medium" as const,
                  },
                  {
                    module: "Writing — Task 2 Idea Development",
                    skill: "writing",
                    accuracyPercent: 62,
                    recommendation: "Provide concrete examples supporting main arguments.",
                    severity: "medium" as const,
                  },
                ]
            ).map((wm, i) => (
              <div
                key={wm.module || i}
                className="flex flex-col justify-between rounded-xl border border-white/10 bg-black/25 p-3"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate text-xs font-semibold text-white">{wm.module}</span>
                  <span className="rounded-md border border-amber-500/30 bg-amber-500/15 px-1.5 py-0.5 font-mono text-[10px] font-bold text-amber-300">
                    {wm.accuracyPercent ?? wm.accuracyPct ?? 60}%
                  </span>
                </div>
                <p className="mt-1.5 line-clamp-2 text-[11px] text-white/50">
                  {wm.recommendation}
                </p>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Filter and Table Card */}
      <div className="card rounded-2xl border border-white/10 p-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between border-b border-white/10 pb-4">
          {/* Search */}
          <div className="relative flex-1 max-w-md">
            <svg className="absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-white/40" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by student, ID, phone, or exam title..."
              className="w-full rounded-xl border border-white/10 bg-black/30 py-2.5 pl-10 pr-4 text-xs text-white placeholder-white/35 focus:border-emerald-500 focus:outline-none"
            />
          </div>

          {/* Filters */}
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex items-center rounded-xl border border-white/10 bg-surface/80 p-1">
              {(["all", "IELTS", "MULTILEVEL"] as const).map((p) => (
                <button
                  key={p}
                  type="button"
                  onClick={() => setProgramFilter(p)}
                  className={`rounded-lg px-3 py-1.5 text-xs font-semibold uppercase transition ${
                    programFilter === p
                      ? "bg-emerald-500 text-white shadow-[0_0_12px_rgba(16,185,129,0.3)]"
                      : "text-white/60 hover:text-white"
                  }`}
                >
                  {p}
                </button>
              ))}
            </div>

            <div className="flex items-center rounded-xl border border-white/10 bg-surface/80 p-1">
              {(["all", "clean", "flagged"] as const).map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setCheatFilter(c)}
                  className={`rounded-lg px-3 py-1.5 text-xs font-semibold capitalize transition ${
                    cheatFilter === c
                      ? "bg-white/15 text-white"
                      : "text-white/50 hover:text-white"
                  }`}
                >
                  {c}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Results Table */}
        <div className="mt-4 overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-b border-white/10 text-[11px] uppercase tracking-wider text-white/40">
                <th className="pb-3 pl-2">Candidate</th>
                <th className="pb-3">Exam Title & Date</th>
                <th className="pb-3 text-center">Track</th>
                <th className="pb-3 text-center">Listening</th>
                <th className="pb-3 text-center">Reading</th>
                <th className="pb-3 text-center">Writing</th>
                <th className="pb-3 text-center">Speaking</th>
                <th className="pb-3 text-center">Overall</th>
                <th className="pb-3 text-center">Integrity</th>
                <th className="pb-3 text-right pr-2">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {filtered.map((r) => (
                <tr key={r.id} className="transition hover:bg-white/[0.02]">
                  <td className="py-3.5 pl-2">
                    <p className="font-semibold text-white">{r.studentName}</p>
                    <p className="text-[11px] text-white/45">{r.studentId} · {r.studentPhone}</p>
                  </td>
                  <td className="py-3.5">
                    <p className="font-medium text-white/80">{r.examTitle}</p>
                    <p className="text-[11px] text-white/40">{r.date}</p>
                  </td>
                  <td className="py-3.5 text-center">
                    <span className="rounded-md bg-white/5 px-2 py-0.5 text-[10px] font-bold text-white/70">
                      {r.program}
                    </span>
                  </td>
                  <td className="py-3.5 text-center font-mono font-bold text-white/80">{r.listening}</td>
                  <td className="py-3.5 text-center font-mono font-bold text-white/80">{r.reading}</td>
                  <td className="py-3.5 text-center font-mono font-bold text-white/80">{r.writing}</td>
                  <td className="py-3.5 text-center font-mono font-bold text-white/80">{r.speaking}</td>
                  <td className="py-3.5 text-center">
                    <span className="inline-block rounded-lg bg-emerald-500/15 px-2.5 py-1 font-mono text-xs font-black text-emerald-400">
                      {r.program === "IELTS" ? `Band ${r.overallBand}` : `${r.overallBand} pts`}
                    </span>
                  </td>
                  <td className="py-3.5 text-center">
                    {r.cheatFlagsCount === 0 ? (
                      <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-400">
                        <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
                        Clean
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 rounded-md bg-amber-500/15 px-2 py-0.5 text-[10px] font-bold text-amber-300">
                        ⚠ {r.cheatFlagsCount} flags
                      </span>
                    )}
                  </td>
                  <td className="py-3.5 text-right pr-2">
                    <button
                      type="button"
                      onClick={() => setSelectedStudent(r)}
                      className="rounded-lg border border-white/10 bg-white/5 px-2.5 py-1.5 text-xs font-semibold text-white/70 hover:bg-white/10 hover:text-white"
                    >
                      Certificate
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Official Score Card Modal */}
      {selectedStudent && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 backdrop-blur-md">
          <div className="card w-full max-w-lg rounded-3xl border border-white/15 p-7 shadow-2xl">
            <div className="flex items-start justify-between border-b border-white/10 pb-4">
              <div>
                <span className="text-[10px] font-bold uppercase tracking-widest text-emerald-400">Official Exam Certificate</span>
                <h3 className="text-xl font-bold text-white">{selectedStudent.studentName}</h3>
                <p className="text-xs text-white/50">ID: {selectedStudent.studentId} · {selectedStudent.examTitle}</p>
              </div>
              <button
                type="button"
                onClick={() => setSelectedStudent(null)}
                className="rounded-lg p-1 text-white/50 hover:bg-white/10 hover:text-white"
              >
                ✕
              </button>
            </div>

            <div className="mt-6 rounded-2xl border border-emerald-500/40 bg-gradient-to-br from-emerald-500/15 to-[#89F336]/5 p-5 text-center">
              <p className="text-xs uppercase tracking-widest text-emerald-300 font-semibold">Overall Achieved Performance</p>
              <p className="mt-2 text-5xl font-black text-white">
                {selectedStudent.program === "IELTS" ? `Band ${selectedStudent.overallBand}` : `${selectedStudent.overallBand} Points`}
              </p>
              <p className="mt-2 text-xs font-bold text-emerald-400">CEFR Framework Level: {selectedStudent.cefrLevel}</p>
            </div>

            <div className="mt-5 grid grid-cols-4 gap-2 text-center">
              <div className="rounded-xl border border-white/10 bg-black/30 p-3">
                <p className="text-[10px] text-white/40">Listening</p>
                <p className="mt-1 font-mono text-base font-bold text-white">{selectedStudent.listening}</p>
              </div>
              <div className="rounded-xl border border-white/10 bg-black/30 p-3">
                <p className="text-[10px] text-white/40">Reading</p>
                <p className="mt-1 font-mono text-base font-bold text-white">{selectedStudent.reading}</p>
              </div>
              <div className="rounded-xl border border-white/10 bg-black/30 p-3">
                <p className="text-[10px] text-white/40">Writing</p>
                <p className="mt-1 font-mono text-base font-bold text-white">{selectedStudent.writing}</p>
              </div>
              <div className="rounded-xl border border-white/10 bg-black/30 p-3">
                <p className="text-[10px] text-white/40">Speaking</p>
                <p className="mt-1 font-mono text-base font-bold text-white">{selectedStudent.speaking}</p>
              </div>
            </div>

            <div className="mt-5 flex items-center justify-between rounded-xl border border-white/10 bg-white/[0.02] p-3 text-xs">
              <span className="text-white/60">Proctoring Status:</span>
              {selectedStudent.cheatFlagsCount === 0 ? (
                <span className="font-semibold text-emerald-400">✓ Fully Verified & Clean</span>
              ) : (
                <span className="font-semibold text-amber-400">⚠ {selectedStudent.cheatFlagsCount} Flags Logged</span>
              )}
            </div>

            <div className="mt-6 flex items-center justify-end gap-2 border-t border-white/10 pt-4">
              <button
                type="button"
                onClick={() => {
                  triggerToast(`Score Card printed/exported for ${selectedStudent.studentName}`);
                  setSelectedStudent(null);
                }}
                className="btn-brand px-5 py-2.5 text-xs font-bold"
              >
                Download Official PDF
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
