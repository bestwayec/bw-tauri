import { useState } from "react";

export interface GroupStudentResult {
  id: string;
  name: string;
  phone: string;
  latestExam: string;
  examDate: string;
  listening: number;
  reading: number;
  writing: number;
  speaking: number;
  overallBand: number;
  cefrLevel: "B1" | "B2" | "C1" | "C2";
  status: "Completed" | "Improving" | "Needs Attention";
}

export interface StudentGroup {
  id: string;
  name: string;
  program: "IELTS" | "MULTILEVEL";
  schedule: string;
  teacherName: string;
  targetBand: number;
  students: GroupStudentResult[];
}

const GROUPS_DATA: StudentGroup[] = [
  {
    id: "grp-ielts-m1",
    name: "IELTS Intensive Morning - Lab 101",
    program: "IELTS",
    schedule: "Mon, Wed, Fri · 09:00 - 11:30",
    teacherName: "Anvar Ruziyev",
    targetBand: 7.0,
    students: [
      {
        id: "st-1",
        name: "Azamat Karimov",
        phone: "+998 90 123 45 67",
        latestExam: "IELTS Academic Mock 14",
        examDate: "Oct 12, 2026",
        listening: 7.5,
        reading: 7.0,
        writing: 6.5,
        speaking: 7.0,
        overallBand: 7.0,
        cefrLevel: "C1",
        status: "Completed",
      },
      {
        id: "st-2",
        name: "Madina Usmanova",
        phone: "+998 93 456 78 90",
        latestExam: "IELTS Academic Mock 14",
        examDate: "Oct 12, 2026",
        listening: 8.0,
        reading: 8.5,
        writing: 7.0,
        speaking: 7.5,
        overallBand: 8.0,
        cefrLevel: "C1",
        status: "Improving",
      },
      {
        id: "st-3",
        name: "Zarina Alimova",
        phone: "+998 99 234 56 78",
        latestExam: "IELTS Academic Mock 13",
        examDate: "Oct 10, 2026",
        listening: 6.5,
        reading: 6.0,
        writing: 5.5,
        speaking: 6.0,
        overallBand: 6.0,
        cefrLevel: "B2",
        status: "Needs Attention",
      },
      {
        id: "st-4",
        name: "Dilorom Boboeva",
        phone: "+998 90 987 65 43",
        latestExam: "IELTS General Mock 05",
        examDate: "Oct 09, 2026",
        listening: 7.0,
        reading: 7.0,
        writing: 6.5,
        speaking: 6.5,
        overallBand: 7.0,
        cefrLevel: "C1",
        status: "Completed",
      },
      {
        id: "st-5",
        name: "Bekzod Shukurov",
        phone: "+998 91 876 54 32",
        latestExam: "IELTS Academic Mock 14",
        examDate: "Oct 12, 2026",
        listening: 7.5,
        reading: 7.5,
        writing: 6.5,
        speaking: 7.0,
        overallBand: 7.0,
        cefrLevel: "C1",
        status: "Improving",
      },
    ],
  },
  {
    id: "grp-multi-e2",
    name: "CEFR Multilevel B2/C1 FastTrack",
    program: "MULTILEVEL",
    schedule: "Tue, Thu, Sat · 14:00 - 16:30",
    teacherName: "Anvar Ruziyev",
    targetBand: 65,
    students: [
      {
        id: "st-6",
        name: "Javohir Tursunov",
        phone: "+998 97 789 01 23",
        latestExam: "CEFR Multilevel Standard Exam 08",
        examDate: "Oct 11, 2026",
        listening: 68,
        reading: 64,
        writing: 62,
        speaking: 66,
        overallBand: 65,
        cefrLevel: "B2",
        status: "Completed",
      },
      {
        id: "st-7",
        name: "Sherzod Rakhimov",
        phone: "+998 91 345 67 89",
        latestExam: "CEFR Multilevel Standard Exam 08",
        examDate: "Oct 11, 2026",
        listening: 72,
        reading: 70,
        writing: 65,
        speaking: 68,
        overallBand: 69,
        cefrLevel: "C1",
        status: "Improving",
      },
    ],
  },
];

export default function GroupsResults() {
  const [groups] = useState<StudentGroup[]>(GROUPS_DATA);
  const [selectedGroupId, setSelectedGroupId] = useState<string>("grp-ielts-m1");
  const [search, setSearch] = useState("");
  const [inspectStudent, setInspectStudent] = useState<GroupStudentResult | null>(null);

  const activeGroup = groups.find((g) => g.id === selectedGroupId) ?? groups[0];

  const filteredStudents = activeGroup.students.filter((st) =>
    st.name.toLowerCase().includes(search.toLowerCase()) ||
    st.phone.toLowerCase().includes(search.toLowerCase())
  );

  const avgBand =
    activeGroup.students.length > 0
      ? (
          activeGroup.students.reduce((acc, s) => acc + s.overallBand, 0) /
          activeGroup.students.length
        ).toFixed(1)
      : "0";

  const targetReachedCount = activeGroup.students.filter(
    (s) => s.overallBand >= activeGroup.targetBand
  ).length;

  const targetRate =
    activeGroup.students.length > 0
      ? Math.round((targetReachedCount / activeGroup.students.length) * 100)
      : 0;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-white">Groups & Academic Results</h1>
          <p className="mt-1 text-xs text-white/50">
            Track student cohorts, individual section band performances, and test progress.
          </p>
        </div>

        {/* Group Selector Dropdown */}
        <div className="flex items-center gap-3">
          <select
            value={selectedGroupId}
            onChange={(e) => setSelectedGroupId(e.target.value)}
            className="rounded-xl border border-white/10 bg-surface px-4 py-2.5 text-xs font-semibold text-white focus:border-emerald-500 focus:outline-none"
          >
            {groups.map((g) => (
              <option key={g.id} value={g.id} className="bg-surface text-white">
                {g.name} ({g.program})
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Group KPI Cards */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <div className="card rounded-2xl p-4">
          <p className="text-xs font-medium uppercase tracking-wider text-white/40">Cohort Size</p>
          <p className="mt-2 text-3xl font-extrabold text-white">{activeGroup.students.length}</p>
          <p className="mt-2 text-[11px] text-white/45">Active registered candidates</p>
        </div>
        <div className="card rounded-2xl p-4">
          <p className="text-xs font-medium uppercase tracking-wider text-white/40">Class Average</p>
          <p className="mt-2 text-3xl font-extrabold text-emerald-400">
            {activeGroup.program === "IELTS" ? `Band ${avgBand}` : `${avgBand} pts`}
          </p>
          <p className="mt-2 text-[11px] text-emerald-400/80">Target: {activeGroup.targetBand}</p>
        </div>
        <div className="card rounded-2xl p-4">
          <p className="text-xs font-medium uppercase tracking-wider text-white/40">Pass Rate</p>
          <p className="mt-2 text-3xl font-extrabold text-emerald-400">{targetRate}%</p>
          <p className="mt-2 text-[11px] text-white/45">{targetReachedCount} of {activeGroup.students.length} on track</p>
        </div>
        <div className="card rounded-2xl p-4">
          <p className="text-xs font-medium uppercase tracking-wider text-white/40">Schedule & Hall</p>
          <p className="mt-2 text-sm font-bold text-white truncate">{activeGroup.schedule}</p>
          <p className="mt-2 text-[11px] text-white/45">Instructor: {activeGroup.teacherName}</p>
        </div>
      </div>

      {/* Filter and Table */}
      <div className="card rounded-2xl border border-white/10 p-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between border-b border-white/10 pb-4">
          <h2 className="text-base font-bold text-white">Group Candidates Score Breakdown</h2>
          <div className="relative w-full sm:w-72">
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search candidate name or phone..."
              className="w-full rounded-xl border border-white/10 bg-black/30 py-2 pl-3 pr-4 text-xs text-white placeholder-white/30 focus:border-emerald-500 focus:outline-none"
            />
          </div>
        </div>

        <div className="mt-4 overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-b border-white/10 text-[11px] uppercase tracking-wider text-white/40">
                <th className="pb-3 pl-2">Candidate</th>
                <th className="pb-3">Latest Exam & Date</th>
                <th className="pb-3 text-center">Listening</th>
                <th className="pb-3 text-center">Reading</th>
                <th className="pb-3 text-center">Writing</th>
                <th className="pb-3 text-center">Speaking</th>
                <th className="pb-3 text-center">Overall</th>
                <th className="pb-3 text-center">Status</th>
                <th className="pb-3 text-right pr-2">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {filteredStudents.map((st) => (
                <tr key={st.id} className="transition hover:bg-white/[0.02]">
                  <td className="py-3.5 pl-2">
                    <p className="font-semibold text-white">{st.name}</p>
                    <p className="text-[11px] text-white/45">{st.phone}</p>
                  </td>
                  <td className="py-3.5">
                    <p className="font-medium text-white/80">{st.latestExam}</p>
                    <p className="text-[11px] text-white/40">{st.examDate}</p>
                  </td>
                  <td className="py-3.5 text-center font-mono font-bold text-white/80">{st.listening}</td>
                  <td className="py-3.5 text-center font-mono font-bold text-white/80">{st.reading}</td>
                  <td className="py-3.5 text-center font-mono font-bold text-white/80">{st.writing}</td>
                  <td className="py-3.5 text-center font-mono font-bold text-white/80">{st.speaking}</td>
                  <td className="py-3.5 text-center">
                    <span className="inline-block rounded-lg bg-emerald-500/15 px-2.5 py-1 font-mono text-xs font-black text-emerald-400">
                      {activeGroup.program === "IELTS" ? `Band ${st.overallBand}` : `${st.overallBand} pts`}
                    </span>
                  </td>
                  <td className="py-3.5 text-center">
                    <span
                      className={`inline-block rounded-full px-2 py-0.5 text-[10px] font-bold ${
                        st.status === "Completed"
                          ? "bg-emerald-500/20 text-emerald-300"
                          : st.status === "Improving"
                          ? "bg-cyan-500/20 text-cyan-300"
                          : "bg-amber-500/20 text-amber-300"
                      }`}
                    >
                      {st.status}
                    </span>
                  </td>
                  <td className="py-3.5 text-right pr-2">
                    <button
                      type="button"
                      onClick={() => setInspectStudent(st)}
                      className="rounded-lg border border-white/10 bg-white/5 px-2.5 py-1.5 text-xs font-semibold text-white/70 hover:bg-white/10 hover:text-white"
                    >
                      Details
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Inspect Student Modal */}
      {inspectStudent && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 backdrop-blur-md">
          <div className="card w-full max-w-md rounded-3xl border border-white/15 p-6 shadow-2xl">
            <div className="flex items-start justify-between">
              <div>
                <h3 className="text-lg font-bold text-white">{inspectStudent.name}</h3>
                <p className="text-xs text-white/50">{inspectStudent.phone} · {inspectStudent.latestExam}</p>
              </div>
              <button
                type="button"
                onClick={() => setInspectStudent(null)}
                className="rounded-lg p-1 text-white/50 hover:bg-white/10 hover:text-white"
              >
                ✕
              </button>
            </div>

            <div className="mt-5 rounded-2xl border border-emerald-500/30 bg-emerald-500/10 p-4 text-center">
              <p className="text-xs font-semibold uppercase tracking-wider text-emerald-400">Official Exam Result</p>
              <p className="mt-1 text-4xl font-black text-white">
                {activeGroup.program === "IELTS" ? `Band ${inspectStudent.overallBand}` : `${inspectStudent.overallBand} Points`}
              </p>
              <p className="mt-1 text-xs text-emerald-300 font-semibold">CEFR Level: {inspectStudent.cefrLevel}</p>
            </div>

            <div className="mt-4 grid grid-cols-4 gap-2 text-center">
              <div className="rounded-xl border border-white/10 bg-black/30 p-2.5">
                <p className="text-[10px] text-white/40">Listening</p>
                <p className="mt-1 font-mono text-base font-bold text-white">{inspectStudent.listening}</p>
              </div>
              <div className="rounded-xl border border-white/10 bg-black/30 p-2.5">
                <p className="text-[10px] text-white/40">Reading</p>
                <p className="mt-1 font-mono text-base font-bold text-white">{inspectStudent.reading}</p>
              </div>
              <div className="rounded-xl border border-white/10 bg-black/30 p-2.5">
                <p className="text-[10px] text-white/40">Writing</p>
                <p className="mt-1 font-mono text-base font-bold text-white">{inspectStudent.writing}</p>
              </div>
              <div className="rounded-xl border border-white/10 bg-black/30 p-2.5">
                <p className="text-[10px] text-white/40">Speaking</p>
                <p className="mt-1 font-mono text-base font-bold text-white">{inspectStudent.speaking}</p>
              </div>
            </div>

            <div className="mt-6 flex justify-end">
              <button
                type="button"
                onClick={() => setInspectStudent(null)}
                className="btn-brand px-5 py-2 text-xs font-bold"
              >
                Close Report
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
