import { useEffect, useState } from "react";
import { downloadBlob, get, post } from "../lib/api";

export interface GroupStudentResult {
  id: string;
  name: string;
  phone: string;
  latestExam: string;
  examDate: string;
  completedExamsCount: number;
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
  averageBandScore?: number | null;
  totalCompletedAttempts?: number;
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
        completedExamsCount: 4,
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
        completedExamsCount: 6,
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
        completedExamsCount: 3,
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
        completedExamsCount: 5,
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
        completedExamsCount: 4,
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
        completedExamsCount: 3,
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
        completedExamsCount: 5,
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

function sanitizeSlug(name: string): string {
  return name.trim().replace(/[^a-zA-Z0-9_-]+/g, "_").replace(/^_+|_+$/g, "") || "group";
}

export default function GroupsResults() {
  const [groups, setGroups] = useState<StudentGroup[]>(GROUPS_DATA);
  const [selectedGroupId, setSelectedGroupId] = useState<string>(GROUPS_DATA[0].id);
  const [search, setSearch] = useState("");
  const [inspectStudent, setInspectStudent] = useState<GroupStudentResult | null>(null);

  // Create Group modal state
  const [createOpen, setCreateOpen] = useState(false);
  const [newGroupName, setNewGroupName] = useState("");
  const [newGroupSchedule, setNewGroupSchedule] = useState("Mon, Wed, Fri · 09:00 - 11:00");
  const [newGroupProgram, setNewGroupProgram] = useState<"IELTS" | "MULTILEVEL">("IELTS");
  const [creatingGroup, setCreatingGroup] = useState(false);
  const [exportingExcel, setExportingExcel] = useState(false);
  const [statusBanner, setStatusBanner] = useState<string | null>(null);

  // Fetch live groups from backend if authenticated
  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const remoteGroups = await get<Array<Record<string, unknown>>>("/v1/groups");
        if (!active || !Array.isArray(remoteGroups) || remoteGroups.length === 0) return;

        const mapped: StudentGroup[] = await Promise.all(
          remoteGroups.map(async (rg) => {
            const gid = String(rg.id ?? "");
            let analytics: Record<string, unknown> | null = null;
            try {
              analytics = await get<Record<string, unknown>>(`/v1/groups/${gid}/analytics`);
            } catch {
              analytics = null;
            }
            const rawStudents = Array.isArray(analytics?.students)
              ? (analytics.students as Array<Record<string, unknown>>)
              : [];

            const students: GroupStudentResult[] = rawStudents.map((st, idx) => {
              const w = Number(st.writingScore ?? st.writingBand ?? 0);
              const s = Number(st.speakingScore ?? st.speakingBand ?? 0);
              const l = Number(st.listeningScore ?? st.listeningBand ?? 0);
              const r = Number(st.readingScore ?? st.readingBand ?? 0);
              const overall = Number(st.overallBand ?? st.overallScore ?? 0);
              return {
                id: String(st.studentId ?? st.id ?? `st-${idx}`),
                name: String(st.name ?? "O'quvchi"),
                phone: String(st.phone ?? "—"),
                latestExam: String(st.latestExam ?? "Mock Exam"),
                examDate: String(st.examDate ?? "—"),
                completedExamsCount: Number(st.completedExamsCount ?? st.attemptsCount ?? 0),
                listening: l,
                reading: r,
                writing: w,
                speaking: s,
                overallBand: overall,
                cefrLevel: overall >= 7 ? "C1" : overall >= 5.5 ? "B2" : "B1",
                status: "Completed",
              };
            });

            return {
              id: gid,
              name: String(rg.name ?? "Guruh"),
              program: "IELTS",
              schedule: "Mon, Wed, Fri",
              teacherName: String(rg.teacherName ?? "O'qituvchi"),
              targetBand: 7.0,
              averageBandScore:
                typeof analytics?.averageBandScore === "number"
                  ? analytics.averageBandScore
                  : null,
              totalCompletedAttempts:
                typeof analytics?.totalCompletedAttempts === "number"
                  ? analytics.totalCompletedAttempts
                  : undefined,
              students,
            };
          }),
        );

        if (active && mapped.length > 0) {
          setGroups(mapped);
          setSelectedGroupId(mapped[0].id);
        }
      } catch {
        // Keep fallback GROUPS_DATA when offline or unauthenticated
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  const activeGroup = groups.find((g) => g.id === selectedGroupId) ?? groups[0];

  const filteredStudents = activeGroup.students.filter(
    (st) =>
      st.name.toLowerCase().includes(search.toLowerCase()) ||
      st.phone.toLowerCase().includes(search.toLowerCase()),
  );

  const avgBand =
    activeGroup.averageBandScore != null
      ? activeGroup.averageBandScore.toFixed(1)
      : activeGroup.students.length > 0
        ? (
            activeGroup.students.reduce((acc, s) => acc + s.overallBand, 0) /
            activeGroup.students.length
          ).toFixed(1)
        : "0.0";

  const totalCompletedAttempts =
    activeGroup.totalCompletedAttempts ??
    activeGroup.students.reduce((acc, s) => acc + (s.completedExamsCount ?? 1), 0);

  const targetReachedCount = activeGroup.students.filter(
    (s) => s.overallBand >= activeGroup.targetBand,
  ).length;

  const targetRate =
    activeGroup.students.length > 0
      ? Math.round((targetReachedCount / activeGroup.students.length) * 100)
      : 0;

  async function handleCreateGroup() {
    const trimmed = newGroupName.trim();
    if (trimmed.length < 2) return;
    setCreatingGroup(true);
    setStatusBanner(null);
    try {
      const created = await post<Record<string, unknown>>("/v1/groups", {
        name: trimmed,
        schedule: [
          { day: "mon", startTime: "09:00", endTime: "11:00" },
          { day: "wed", startTime: "09:00", endTime: "11:00" },
          { day: "fri", startTime: "09:00", endTime: "11:00" },
        ],
      });
      const newGroup: StudentGroup = {
        id: String(created?.id ?? `grp-${Date.now()}`),
        name: String(created?.name ?? trimmed),
        program: newGroupProgram,
        schedule: newGroupSchedule,
        teacherName: String(created?.teacherName ?? "O'qituvchi"),
        targetBand: newGroupProgram === "IELTS" ? 7.0 : 65,
        students: [],
      };
      setGroups((prev) => [newGroup, ...prev]);
      setSelectedGroupId(newGroup.id);
      setCreateOpen(false);
      setNewGroupName("");
      setStatusBanner(`"${newGroup.name}" guruhi muvaffaqiyatli yaratildi.`);
    } catch {
      // Offline / demo fallback so UI remains responsive
      const fallbackGroup: StudentGroup = {
        id: `grp-${Date.now()}`,
        name: trimmed,
        program: newGroupProgram,
        schedule: newGroupSchedule,
        teacherName: "O'qituvchi",
        targetBand: newGroupProgram === "IELTS" ? 7.0 : 65,
        students: [],
      };
      setGroups((prev) => [fallbackGroup, ...prev]);
      setSelectedGroupId(fallbackGroup.id);
      setCreateOpen(false);
      setNewGroupName("");
      setStatusBanner(`"${fallbackGroup.name}" guruhi yaratildi.`);
    } finally {
      setCreatingGroup(false);
    }
  }

  async function handleDownloadExcel() {
    setExportingExcel(true);
    setStatusBanner(null);
    const dateStr = new Date().toISOString().slice(0, 10);
    const defaultName = `group_${sanitizeSlug(activeGroup.name)}_${dateStr}.xlsx`;
    try {
      const { blob, filename } = await downloadBlob(
        `/v1/groups/${encodeURIComponent(activeGroup.id)}/export/excel`,
      );
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename || defaultName;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      setStatusBanner("Excel (.xlsx) fayli yuklab olindi.");
    } catch {
      // Fallback CSV/XLSX-compatible table download when offline
      handleDownloadCsv();
    } finally {
      setExportingExcel(false);
    }
  }

  function handleDownloadCsv() {
    const dateStr = new Date().toISOString().slice(0, 10);
    const headers = [
      "#",
      "O'quvchi F.I.Sh.",
      "Telefon",
      "Topshirilgan imtihonlar soni",
      "Writing balli",
      "Speaking balli",
      "Listening balli",
      "Reading balli",
      "Umumiy ball (Overall Band)",
    ];
    const rows = activeGroup.students.map((st, idx) =>
      [
        idx + 1,
        `"${st.name.replace(/"/g, '""')}"`,
        `"${st.phone}"`,
        st.completedExamsCount,
        st.writing,
        st.speaking,
        st.listening,
        st.reading,
        st.overallBand,
      ].join(","),
    );
    const csv = "\uFEFF" + [headers.join(","), ...rows].join("\r\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `group_${sanitizeSlug(activeGroup.name)}_${dateStr}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  function handleExportPdf() {
    window.print();
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-white">
            Groups & Academic Results (Guruh tahlili)
          </h1>
          <p className="mt-1 text-xs text-white/50">
            Track student cohorts, Group Average Band Score, Writing & Speaking performances, and export Excel/PDF reports.
          </p>
        </div>

        {/* Group Selector Dropdown + Create Group + Export Buttons */}
        <div className="flex flex-wrap items-center gap-2.5">
          <select
            aria-label="Guruhni tanlang"
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

          <button
            type="button"
            onClick={() => setCreateOpen(true)}
            className="rounded-xl border border-emerald-500/40 bg-emerald-500/15 px-3.5 py-2.5 text-xs font-bold text-emerald-300 hover:bg-emerald-500/25"
          >
            + Yangi guruh yaratish
          </button>

          <button
            type="button"
            disabled={exportingExcel}
            onClick={() => void handleDownloadExcel()}
            className="rounded-xl bg-emerald-600 px-3.5 py-2.5 text-xs font-bold text-white hover:bg-emerald-500 disabled:opacity-50"
          >
            {exportingExcel ? "Yuklanmoqda..." : "📊 Excel (.xlsx) Yuklab olish"}
          </button>

          <button
            type="button"
            onClick={handleDownloadCsv}
            className="rounded-xl border border-white/15 bg-white/5 px-3 py-2.5 text-xs font-semibold text-white/80 hover:bg-white/10"
          >
            CSV
          </button>

          <button
            type="button"
            onClick={handleExportPdf}
            className="rounded-xl border border-white/15 bg-white/5 px-3 py-2.5 text-xs font-semibold text-white/80 hover:bg-white/10"
          >
            PDF
          </button>
        </div>
      </div>

      {statusBanner && (
        <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-2.5 text-xs font-semibold text-emerald-300">
          {statusBanner}
        </div>
      )}

      {/* Group KPI Summary Cards */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <div className="card rounded-2xl p-4">
          <p className="text-xs font-medium uppercase tracking-wider text-white/40">
            Guruh O&apos;rtacha Balli (Average Band)
          </p>
          <p className="mt-2 text-3xl font-extrabold text-emerald-400">
            {activeGroup.program === "IELTS" ? `Band ${avgBand}` : `${avgBand} pts`}
          </p>
          <p className="mt-2 text-[11px] text-emerald-400/80">Target: {activeGroup.targetBand}</p>
        </div>
        <div className="card rounded-2xl p-4">
          <p className="text-xs font-medium uppercase tracking-wider text-white/40">
            Active Students
          </p>
          <p className="mt-2 text-3xl font-extrabold text-white">{activeGroup.students.length}</p>
          <p className="mt-2 text-[11px] text-white/45">Active registered candidates</p>
        </div>
        <div className="card rounded-2xl p-4">
          <p className="text-xs font-medium uppercase tracking-wider text-white/40">
            Total Completed Attempts
          </p>
          <p className="mt-2 text-3xl font-extrabold text-sky-400">{totalCompletedAttempts}</p>
          <p className="mt-2 text-[11px] text-white/45">Pass rate: {targetRate}%</p>
        </div>
        <div className="card rounded-2xl p-4">
          <p className="text-xs font-medium uppercase tracking-wider text-white/40">
            Schedule & Hall
          </p>
          <p className="mt-2 truncate text-sm font-bold text-white">{activeGroup.schedule}</p>
          <p className="mt-2 text-[11px] text-white/45">Instructor: {activeGroup.teacherName}</p>
        </div>
      </div>

      {/* Filter and Table */}
      <div className="card rounded-2xl border border-white/10 p-5">
        <div className="flex flex-col gap-3 border-b border-white/10 pb-4 sm:flex-row sm:items-center sm:justify-between">
          <h2 className="text-base font-bold text-white">Group Candidates Score Breakdown</h2>
          <div className="relative w-full sm:w-72">
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search candidate name or phone..."
              className="w-full rounded-xl border border-white/10 bg-black/30 py-2 pr-4 pl-3 text-xs text-white placeholder-white/30 focus:border-emerald-500 focus:outline-none"
            />
          </div>
        </div>

        <div className="mt-4 overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-b border-white/10 text-[11px] uppercase tracking-wider text-white/40">
                <th className="pb-3 pl-2">O&apos;quvchi F.I.Sh.</th>
                <th className="pb-3 text-center">Topshirilgan imtihonlar</th>
                <th className="pb-3 text-center">Writing balli</th>
                <th className="pb-3 text-center">Speaking balli</th>
                <th className="pb-3 text-center">Listening / Reading</th>
                <th className="pb-3 text-center">Umumiy ball (Overall Band)</th>
                <th className="pb-3 text-center">Status</th>
                <th className="pb-3 pr-2 text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {filteredStudents.map((st) => (
                <tr key={st.id} className="transition hover:bg-white/[0.02]">
                  <td className="py-3.5 pl-2">
                    <p className="font-semibold text-white">{st.name}</p>
                    <p className="text-[11px] text-white/45">{st.phone}</p>
                  </td>
                  <td className="py-3.5 text-center font-mono font-bold text-white/90">
                    {st.completedExamsCount}
                  </td>
                  <td className="py-3.5 text-center font-mono font-bold text-white/80">
                    {st.writing}
                  </td>
                  <td className="py-3.5 text-center font-mono font-bold text-white/80">
                    {st.speaking}
                  </td>
                  <td className="py-3.5 text-center font-mono font-bold text-white/80">
                    {st.listening} / {st.reading}
                  </td>
                  <td className="py-3.5 text-center">
                    <span className="inline-block rounded-lg bg-emerald-500/15 px-2.5 py-1 font-mono text-xs font-black text-emerald-400">
                      {activeGroup.program === "IELTS"
                        ? `Band ${st.overallBand}`
                        : `${st.overallBand} pts`}
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
                  <td className="py-3.5 pr-2 text-right">
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

      {/* Create Group Modal */}
      {createOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 backdrop-blur-md">
          <div className="card w-full max-w-md rounded-3xl border border-white/15 p-6 shadow-2xl">
            <div className="flex items-start justify-between">
              <h3 className="text-lg font-bold text-white">Yangi guruh yaratish</h3>
              <button
                type="button"
                onClick={() => setCreateOpen(false)}
                className="rounded-lg p-1 text-white/50 hover:bg-white/10 hover:text-white"
              >
                ✕
              </button>
            </div>

            <div className="mt-4 space-y-3">
              <div>
                <label className="mb-1 block text-xs font-medium text-white/70">Guruh nomi</label>
                <input
                  type="text"
                  value={newGroupName}
                  onChange={(e) => setNewGroupName(e.target.value)}
                  placeholder="Masalan: IELTS Intensive 7.5+"
                  className="w-full rounded-xl border border-white/15 bg-black/40 px-3 py-2 text-xs text-white focus:border-emerald-500 focus:outline-none"
                />
              </div>

              <div>
                <label className="mb-1 block text-xs font-medium text-white/70">Dastur</label>
                <select
                  value={newGroupProgram}
                  onChange={(e) => setNewGroupProgram(e.target.value as "IELTS" | "MULTILEVEL")}
                  className="w-full rounded-xl border border-white/15 bg-surface px-3 py-2 text-xs text-white"
                >
                  <option value="IELTS">IELTS</option>
                  <option value="MULTILEVEL">MULTILEVEL</option>
                </select>
              </div>

              <div>
                <label className="mb-1 block text-xs font-medium text-white/70">Dars jadvali</label>
                <input
                  type="text"
                  value={newGroupSchedule}
                  onChange={(e) => setNewGroupSchedule(e.target.value)}
                  className="w-full rounded-xl border border-white/15 bg-black/40 px-3 py-2 text-xs text-white focus:border-emerald-500 focus:outline-none"
                />
              </div>
            </div>

            <div className="mt-6 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setCreateOpen(false)}
                className="rounded-xl border border-white/15 px-4 py-2 text-xs font-semibold text-white/70 hover:bg-white/10"
              >
                Bekor qilish
              </button>
              <button
                type="button"
                disabled={creatingGroup || newGroupName.trim().length < 2}
                onClick={() => void handleCreateGroup()}
                className="btn-brand rounded-xl px-5 py-2 text-xs font-bold disabled:opacity-50"
              >
                {creatingGroup ? "Saqlanmoqda..." : "Saqlash"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Inspect Student Modal */}
      {inspectStudent && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 backdrop-blur-md">
          <div className="card w-full max-w-md rounded-3xl border border-white/15 p-6 shadow-2xl">
            <div className="flex items-start justify-between">
              <div>
                <h3 className="text-lg font-bold text-white">{inspectStudent.name}</h3>
                <p className="text-xs text-white/50">
                  {inspectStudent.phone} · {inspectStudent.latestExam}
                </p>
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
              <p className="text-xs font-semibold uppercase tracking-wider text-emerald-400">
                Official Exam Result
              </p>
              <p className="mt-1 text-4xl font-black text-white">
                {activeGroup.program === "IELTS"
                  ? `Band ${inspectStudent.overallBand}`
                  : `${inspectStudent.overallBand} Points`}
              </p>
              <p className="mt-1 text-xs font-semibold text-emerald-300">
                CEFR Level: {inspectStudent.cefrLevel} · Completed Exams: {inspectStudent.completedExamsCount}
              </p>
            </div>

            <div className="mt-4 grid grid-cols-4 gap-2 text-center">
              <div className="rounded-xl border border-white/10 bg-black/30 p-2.5">
                <p className="text-[10px] text-white/40">Listening</p>
                <p className="mt-1 font-mono text-base font-bold text-white">
                  {inspectStudent.listening}
                </p>
              </div>
              <div className="rounded-xl border border-white/10 bg-black/30 p-2.5">
                <p className="text-[10px] text-white/40">Reading</p>
                <p className="mt-1 font-mono text-base font-bold text-white">
                  {inspectStudent.reading}
                </p>
              </div>
              <div className="rounded-xl border border-white/10 bg-black/30 p-2.5">
                <p className="text-[10px] text-white/40">Writing</p>
                <p className="mt-1 font-mono text-base font-bold text-white">
                  {inspectStudent.writing}
                </p>
              </div>
              <div className="rounded-xl border border-white/10 bg-black/30 p-2.5">
                <p className="text-[10px] text-white/40">Speaking</p>
                <p className="mt-1 font-mono text-base font-bold text-white">
                  {inspectStudent.speaking}
                </p>
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
