import { useState, useMemo, useEffect } from "react";
import { API_BASE_URL, post } from "@/lib/api";
import type { SimulatorMode } from "@/components/exam-ui/model";
import { multilevelScoreToCefr } from "@/components/ScorePredictionWidget";

export interface LiveExamRoomSession {
  id: string;
  pin: string;
  title: string;
  examType: "IELTS" | "MULTILEVEL";
  simulatorMode: SimulatorMode;
  status: "waiting" | "active" | "completed";
  createdAt: string;
}

/** Generate a 6-digit numeric PIN for a Live Exam Room. */
export function generateSixDigitPin(): string {
  const n = Math.floor(100000 + Math.random() * 900000);
  return String(n);
}

export interface ProctorStudent {
  id: string;
  name: string;
  phone: string;
  terminal: string;
  room: string;
  examTitle: string;
  examType: "IELTS" | "MULTILEVEL";
  currentSection: string;
  totalSections: number;
  currentSectionIndex: number;
  timeElapsedSeconds: number;
  timeLimitSeconds: number;
  status: "active" | "flagged" | "critical" | "submitted";
  estimatedScore?: number;
  antiCheatFlags: {
    blurCount: number;
    shortcutCount: number;
    pasteCount: number;
    devtoolsCount: number;
    multiMonitorAlert: boolean;
    lastEventTime?: string;
    events: Array<{
      time: string;
      kind: string;
      description: string;
      severity: "low" | "medium" | "high";
    }>;
  };
}

const INITIAL_STUDENTS: ProctorStudent[] = [
  {
    id: "stu-101",
    name: "Azamat Karimov",
    phone: "+998 90 123 45 67",
    terminal: "PC-04",
    room: "Lab 101",
    examTitle: "IELTS Academic Mock 14",
    examType: "IELTS",
    currentSection: "Writing Task 2 (Essay)",
    totalSections: 4,
    currentSectionIndex: 3,
    timeElapsedSeconds: 3240,
    timeLimitSeconds: 3600,
    status: "flagged",
    estimatedScore: 54,
    antiCheatFlags: {
      blurCount: 3,
      shortcutCount: 1,
      pasteCount: 2,
      devtoolsCount: 0,
      multiMonitorAlert: false,
      lastEventTime: "2 mins ago",
      events: [
        { time: "14:12:04", kind: "tab_switch", description: "Window lost focus for 4 seconds", severity: "medium" },
        { time: "14:18:22", kind: "paste", description: "External paste operation blocked", severity: "medium" },
        { time: "14:24:50", kind: "shortcut", description: "Blocked Alt+Tab keystroke", severity: "low" },
      ],
    },
  },
  {
    id: "stu-102",
    name: "Madina Usmanova",
    phone: "+998 93 456 78 90",
    terminal: "PC-08",
    room: "Lab 101",
    examTitle: "IELTS Academic Mock 14",
    examType: "IELTS",
    currentSection: "Reading Passage 3",
    totalSections: 4,
    currentSectionIndex: 2,
    timeElapsedSeconds: 2150,
    timeLimitSeconds: 3600,
    status: "active",
    estimatedScore: 63,
    antiCheatFlags: {
      blurCount: 0,
      shortcutCount: 0,
      pasteCount: 0,
      devtoolsCount: 0,
      multiMonitorAlert: false,
      events: [],
    },
  },
  {
    id: "stu-103",
    name: "Javohir Tursunov",
    phone: "+998 97 789 01 23",
    terminal: "PC-12",
    room: "Lab 102",
    examTitle: "CEFR Multilevel B2/C1 Practice",
    examType: "MULTILEVEL",
    currentSection: "Part 2 Speaking",
    totalSections: 4,
    currentSectionIndex: 4,
    timeElapsedSeconds: 840,
    timeLimitSeconds: 900,
    status: "critical",
    estimatedScore: 41,
    antiCheatFlags: {
      blurCount: 6,
      shortcutCount: 4,
      pasteCount: 1,
      devtoolsCount: 1,
      multiMonitorAlert: true,
      lastEventTime: "Just now",
      events: [
        { time: "14:05:11", kind: "multi_monitor", description: "Second display detected and detached", severity: "high" },
        { time: "14:10:45", kind: "devtools", description: "F12 key pressed during speaking section", severity: "high" },
        { time: "14:15:30", kind: "blur", description: "Window minimized / blurred 6 times", severity: "high" },
      ],
    },
  },
  {
    id: "stu-104",
    name: "Zarina Alimova",
    phone: "+998 99 234 56 78",
    terminal: "PC-02",
    room: "Lab 101",
    examTitle: "IELTS Academic Mock 14",
    examType: "IELTS",
    currentSection: "Listening Section 4",
    totalSections: 4,
    currentSectionIndex: 1,
    timeElapsedSeconds: 1680,
    timeLimitSeconds: 2400,
    status: "active",
    estimatedScore: 58,
    antiCheatFlags: {
      blurCount: 0,
      shortcutCount: 0,
      pasteCount: 0,
      devtoolsCount: 0,
      multiMonitorAlert: false,
      events: [],
    },
  },
  {
    id: "stu-105",
    name: "Sherzod Rakhimov",
    phone: "+998 91 345 67 89",
    terminal: "PC-15",
    room: "Lab 102",
    examTitle: "CEFR Multilevel B2/C1 Practice",
    examType: "MULTILEVEL",
    currentSection: "Reading Part 5",
    totalSections: 4,
    currentSectionIndex: 2,
    timeElapsedSeconds: 2500,
    timeLimitSeconds: 3600,
    status: "flagged",
    estimatedScore: 49,
    antiCheatFlags: {
      blurCount: 2,
      shortcutCount: 1,
      pasteCount: 0,
      devtoolsCount: 0,
      multiMonitorAlert: false,
      lastEventTime: "12 mins ago",
      events: [
        { time: "14:02:18", kind: "shortcut", description: "Ctrl+C copy attempt intercepted", severity: "low" },
        { time: "14:14:02", kind: "blur", description: "Window lost focus for 2 seconds", severity: "low" },
      ],
    },
  },
  {
    id: "stu-106",
    name: "Dilorom Boboeva",
    phone: "+998 90 987 65 43",
    terminal: "PC-07",
    room: "Lab 101",
    examTitle: "IELTS General Training Mock",
    examType: "IELTS",
    currentSection: "Writing Task 1 (Letter)",
    totalSections: 4,
    currentSectionIndex: 3,
    timeElapsedSeconds: 1100,
    timeLimitSeconds: 3600,
    status: "active",
    estimatedScore: 66,
    antiCheatFlags: {
      blurCount: 0,
      shortcutCount: 0,
      pasteCount: 0,
      devtoolsCount: 0,
      multiMonitorAlert: false,
      events: [],
    },
  },
];

export default function LiveProctoring() {
  const [students, setStudents] = useState<ProctorStudent[]>(INITIAL_STUDENTS);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | "active" | "flagged" | "critical">("all");
  const [selectedStudent, setSelectedStudent] = useState<ProctorStudent | null>(null);
  const [warningMessage, setWarningMessage] = useState("");
  const [warningModalStudent, setWarningModalStudent] = useState<ProctorStudent | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [autoRefresh, setAutoRefresh] = useState(true);

  // Teacher 6-digit PIN Live Exam Room state
  const [liveRoom, setLiveRoom] = useState<LiveExamRoomSession>({
    id: "room-482910",
    pin: "482910",
    title: "BestWay Group Mock — Lab 101",
    examType: "IELTS",
    simulatorMode: "cdi",
    status: "active",
    createdAt: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
  });
  const [roomTitleInput, setRoomTitleInput] = useState("BestWay Group Mock — Lab 101");
  const [roomExamType, setRoomExamType] = useState<"IELTS" | "MULTILEVEL">("IELTS");
  const [roomSimulatorMode, setRoomSimulatorMode] = useState<SimulatorMode>("cdi");
  const [creatingRoom, setCreatingRoom] = useState(false);

  // Auto-tick elapsed time
  useEffect(() => {
    if (!autoRefresh) return;
    const interval = setInterval(() => {
      setStudents((prev) =>
        prev.map((s) => ({
          ...s,
          timeElapsedSeconds: s.timeElapsedSeconds + 1,
        }))
      );
    }, 1000);
    return () => clearInterval(interval);
  }, [autoRefresh]);

  function triggerToast(msg: string) {
    setToast(msg);
    setTimeout(() => setToast(null), 3500);
  }

  async function handleCreateLiveRoom(e: React.FormEvent) {
    e.preventDefault();
    setCreatingRoom(true);
    const nextPin = generateSixDigitPin();
    try {
      const res = await post<{ id?: string; pin?: string; title?: string; simulatorMode?: SimulatorMode }>("/mock/live-rooms", {
        title: roomTitleInput.trim() || "Classroom Live Mock",
        examType: roomExamType,
        simulatorMode: roomSimulatorMode,
      });
      const pinCode = res?.pin && /^\d{6}$/.test(res.pin) ? res.pin : nextPin;
      setLiveRoom({
        id: res?.id ?? `room-${pinCode}`,
        pin: pinCode,
        title: res?.title ?? (roomTitleInput.trim() || "Classroom Live Mock"),
        examType: roomExamType,
        simulatorMode: res?.simulatorMode ?? roomSimulatorMode,
        status: "active",
        createdAt: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
      });
      triggerToast(`Created Live Exam Room with 6-digit PIN ${pinCode} (${roomSimulatorMode.toUpperCase()} mode).`);
    } catch {
      setLiveRoom({
        id: `room-${nextPin}`,
        pin: nextPin,
        title: roomTitleInput.trim() || "Classroom Live Mock",
        examType: roomExamType,
        simulatorMode: roomSimulatorMode,
        status: "active",
        createdAt: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
      });
      triggerToast(`Live Exam Room ready — 6-digit PIN: ${nextPin} (${roomSimulatorMode.toUpperCase()} mode).`);
    } finally {
      setCreatingRoom(false);
    }
  }

  function handleExportXlsx() {
    const header = [
      "Student Name",
      "Phone",
      "Terminal",
      "Room",
      "Exam Title",
      "Track",
      "Current Section",
      "Score (0-75)",
      "CEFR Level",
      "IELTS Band Est.",
      "Anti-Cheat Status",
      "Blur Count",
      "Paste Count",
    ];
    const rows = students.map((s) => {
      const sc = s.estimatedScore ?? 52;
      const cefr = multilevelScoreToCefr(sc);
      const band = ((sc / 75) * 9).toFixed(1);
      return [
        s.name,
        s.phone,
        s.terminal,
        s.room,
        s.examTitle,
        s.examType,
        s.currentSection,
        String(sc),
        cefr,
        band,
        s.status,
        String(s.antiCheatFlags.blurCount),
        String(s.antiCheatFlags.pasteCount),
      ];
    });
    const tsv = [header, ...rows].map((r) => r.join("\t")).join("\n");
    try {
      const blob = new Blob([tsv], {
        type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet;charset=utf-8",
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `BestWay-LiveRoom-${liveRoom.pin}-Results.xlsx`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch {
      window.open(`${API_BASE_URL}/mock/live-rooms/${encodeURIComponent(liveRoom.id)}/export`, "_blank");
    }
    triggerToast(`Exported ${students.length} student results for Room PIN ${liveRoom.pin} (.xlsx)`);
  }

  function handleSendWarning(e: React.FormEvent) {
    e.preventDefault();
    if (!warningModalStudent || !warningMessage) return;
    triggerToast(`Warning transmitted to ${warningModalStudent.name} (${warningModalStudent.terminal}): "${warningMessage}"`);
    setWarningModalStudent(null);
    setWarningMessage("");
  }

  function handleTerminate(student: ProctorStudent) {
    if (confirm(`Are you sure you want to terminate the exam attempt for ${student.name} (${student.terminal})? This action cannot be undone.`)) {
      setStudents((prev) => prev.filter((s) => s.id !== student.id));
      if (selectedStudent?.id === student.id) setSelectedStudent(null);
      triggerToast(`Exam attempt terminated for ${student.name}.`);
    }
  }

  function handleClearFlags(studentId: string) {
    setStudents((prev) =>
      prev.map((s) => (s.id === studentId ? { ...s, status: "active", antiCheatFlags: { ...s.antiCheatFlags, blurCount: 0, shortcutCount: 0, pasteCount: 0, devtoolsCount: 0, multiMonitorAlert: false } } : s))
    );
    if (selectedStudent?.id === studentId) {
      setSelectedStudent((prev) => (prev ? { ...prev, status: "active" } : null));
    }
    triggerToast("Anti-cheat flags reset to normal.");
  }

  const filtered = useMemo(() => {
    return students.filter((s) => {
      const matchSearch =
        s.name.toLowerCase().includes(search.toLowerCase()) ||
        s.terminal.toLowerCase().includes(search.toLowerCase()) ||
        s.room.toLowerCase().includes(search.toLowerCase()) ||
        s.examTitle.toLowerCase().includes(search.toLowerCase());
      const matchStatus = statusFilter === "all" || s.status === statusFilter;
      return matchSearch && matchStatus;
    });
  }, [students, search, statusFilter]);

  const stats = useMemo(() => {
    const total = students.length;
    const normal = students.filter((s) => s.status === "active").length;
    const flagged = students.filter((s) => s.status === "flagged").length;
    const critical = students.filter((s) => s.status === "critical").length;
    return { total, normal, flagged, critical };
  }, [students]);

  function formatSec(s: number) {
    const m = Math.floor(s / 60);
    const sec = s % 60;
    return `${m}:${sec.toString().padStart(2, "0")}`;
  }

  return (
    <div className="space-y-6">
      {/* Toast */}
      {toast && (
        <div className="fixed right-6 top-6 z-50 flex items-center gap-3 rounded-2xl border border-emerald-500/40 bg-surface/95 px-5 py-3.5 text-sm font-medium text-emerald-300 shadow-2xl backdrop-blur-xl animate-rise">
          <span className="flex h-2.5 w-2.5 rounded-full bg-emerald-400 shadow-[0_0_8px_#10B981]" />
          {toast}
        </div>
      )}

      {/* Header & Live KPI */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold tracking-tight text-white">Live Proctoring Room</h1>
            <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-3 py-1 text-xs font-semibold text-emerald-400">
              <span className="h-2 w-2 animate-ping rounded-full bg-emerald-400" />
              Live Monitoring
            </span>
          </div>
          <p className="mt-1 text-xs text-white/50">
            Real-time anti-cheat surveillance, 6-digit PIN Live Exam Room control & station enforcement.
          </p>
        </div>

        {/* Quick controls */}
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={handleExportXlsx}
            className="rounded-xl border border-emerald-500/35 bg-emerald-500/15 px-3.5 py-2 text-xs font-bold text-emerald-300 transition hover:bg-emerald-500/25"
          >
            ⬇ Export Results (.xlsx)
          </button>
          <button
            type="button"
            onClick={() => setAutoRefresh((v) => !v)}
            className={`flex items-center gap-2 rounded-xl border px-3 py-2 text-xs font-semibold transition ${
              autoRefresh
                ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-300 hover:bg-emerald-500/20"
                : "border-white/10 bg-surface text-white/60 hover:text-white"
            }`}
          >
            <span className={`h-2 w-2 rounded-full ${autoRefresh ? "bg-emerald-400 shadow-[0_0_6px_#10B981]" : "bg-white/40"}`} />
            {autoRefresh ? "Auto-refresh: ON" : "Auto-refresh: OFF"}
          </button>
          <button
            type="button"
            onClick={() => triggerToast("Broadcasted proctor sync ping to all 6 terminals")}
            className="rounded-xl border border-white/10 bg-surface px-3 py-2 text-xs font-semibold text-white/80 transition hover:bg-surface-hover hover:text-white"
          >
            Sync All
          </button>
        </div>
      </div>

      {/* 6-Digit PIN Live Exam Room Control Panel */}
      <div className="card rounded-2xl border border-violet-500/30 bg-gradient-to-br from-violet-950/25 via-[#131C2E] to-[#0B0F17] p-5">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex flex-wrap items-center gap-4">
            <div className="rounded-2xl border border-violet-400/40 bg-black/50 px-5 py-3 text-center">
              <p className="text-[10px] font-bold uppercase tracking-widest text-violet-300">Room 6-Digit PIN</p>
              <p className="mt-0.5 font-mono text-3xl font-black tracking-[0.25em] text-white">{liveRoom.pin}</p>
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="rounded-full bg-emerald-500/15 px-2.5 py-0.5 text-[10px] font-bold uppercase text-emerald-400">
                  {liveRoom.simulatorMode.toUpperCase()} Simulator
                </span>
                <span className="rounded-full bg-white/10 px-2.5 py-0.5 text-[10px] font-bold uppercase text-white/75">
                  {liveRoom.examType}
                </span>
              </div>
              <h2 className="mt-1 text-base font-extrabold text-white">{liveRoom.title}</h2>
              <p className="text-xs text-white/50">
                Students join from Desktop or Web using PIN <strong className="font-mono text-white">{liveRoom.pin}</strong> · Created {liveRoom.createdAt}
              </p>
            </div>
          </div>

          <form onSubmit={(e) => void handleCreateLiveRoom(e)} className="flex flex-wrap items-center gap-2">
            <input
              type="text"
              value={roomTitleInput}
              onChange={(e) => setRoomTitleInput(e.target.value)}
              placeholder="Room title…"
              aria-label="Live room title"
              className="rounded-xl border border-white/10 bg-black/40 px-3 py-2 text-xs text-white placeholder-white/30 focus:border-violet-400 focus:outline-none"
            />
            <select
              value={roomExamType}
              onChange={(e) => setRoomExamType(e.target.value as "IELTS" | "MULTILEVEL")}
              aria-label="Room exam track"
              className="rounded-xl border border-white/10 bg-black/40 px-2.5 py-2 text-xs font-semibold text-white"
            >
              <option value="IELTS">IELTS Track</option>
              <option value="MULTILEVEL">Multi-Level Track</option>
            </select>
            <select
              value={roomSimulatorMode}
              onChange={(e) => setRoomSimulatorMode(e.target.value as SimulatorMode)}
              aria-label="Room simulator mode"
              className="rounded-xl border border-white/10 bg-black/40 px-2.5 py-2 text-xs font-semibold text-white"
            >
              <option value="cdi">CDI Mode</option>
              <option value="dtm">DTM Mode</option>
            </select>
            <button
              type="submit"
              disabled={creatingRoom}
              className="btn-brand rounded-xl px-4 py-2 text-xs font-bold"
            >
              {creatingRoom ? "Generating…" : "New 6-Digit PIN Room"}
            </button>
          </form>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <div className="card rounded-2xl p-4">
          <p className="text-xs font-medium uppercase tracking-wider text-white/40">Active Exams</p>
          <p className="mt-2 text-3xl font-extrabold text-white">{stats.total}</p>
          <div className="mt-2 flex items-center gap-1.5 text-[11px] text-emerald-400">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
            All terminals online
          </div>
        </div>
        <div className="card rounded-2xl p-4">
          <p className="text-xs font-medium uppercase tracking-wider text-white/40">Clean State</p>
          <p className="mt-2 text-3xl font-extrabold text-emerald-400">{stats.normal}</p>
          <p className="mt-2 text-[11px] text-white/45">No flags recorded</p>
        </div>
        <div className="card rounded-2xl p-4">
          <p className="text-xs font-medium uppercase tracking-wider text-white/40">Warnings</p>
          <p className="mt-2 text-3xl font-extrabold text-amber-400">{stats.flagged}</p>
          <p className="mt-2 text-[11px] text-amber-300/80">Minor focus blur/paste</p>
        </div>
        <div className="card rounded-2xl p-4">
          <p className="text-xs font-medium uppercase tracking-wider text-white/40">Critical Alert</p>
          <p className="mt-2 text-3xl font-extrabold text-red-400">{stats.critical}</p>
          <p className="mt-2 text-[11px] text-red-300/80">Immediate attention needed</p>
        </div>
      </div>

      {/* Filter and Search Bar */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="relative flex-1 max-w-md">
          <svg className="absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-white/40" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by student, PC terminal, or exam..."
            className="w-full rounded-xl border border-white/10 bg-surface/80 py-2.5 pl-10 pr-4 text-xs text-white placeholder-white/35 backdrop-blur-md focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500/40"
          />
        </div>
        <div className="flex items-center gap-1.5 rounded-xl border border-white/10 bg-surface/60 p-1 backdrop-blur-md">
          {(["all", "active", "flagged", "critical"] as const).map((st) => (
            <button
              key={st}
              type="button"
              onClick={() => setStatusFilter(st)}
              className={`rounded-lg px-3 py-1.5 text-xs font-medium capitalize transition ${
                statusFilter === st
                  ? "bg-emerald-500 text-white shadow-[0_0_12px_rgba(16,185,129,0.35)]"
                  : "text-white/60 hover:text-white"
              }`}
            >
              {st} {st !== "all" && `(${stats[st === "active" ? "normal" : st]})`}
            </button>
          ))}
        </div>
      </div>

      {/* Main Grid: Student Cards */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 xl:grid-cols-3">
        {filtered.map((s) => {
          const totalFlags = s.antiCheatFlags.blurCount + s.antiCheatFlags.shortcutCount + s.antiCheatFlags.pasteCount + s.antiCheatFlags.devtoolsCount;
          const isCritical = s.status === "critical";
          const isFlagged = s.status === "flagged";
          const progressPercent = Math.min(100, Math.round((s.timeElapsedSeconds / s.timeLimitSeconds) * 100));

          return (
            <div
              key={s.id}
              className={`card group relative flex flex-col justify-between overflow-hidden rounded-2xl border p-5 transition duration-200 hover:border-emerald-500/40 ${
                isCritical
                  ? "border-red-500/40 bg-red-950/20 shadow-[0_0_30px_rgba(239,68,68,0.15)]"
                  : isFlagged
                  ? "border-amber-500/35 bg-amber-950/15"
                  : "border-white/10"
              }`}
            >
              {/* Card top */}
              <div>
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-emerald-500/20 to-emerald-400/10 font-bold text-emerald-400 ring-1 ring-emerald-500/30">
                      {s.name.split(" ").map((n) => n[0]).join("")}
                    </div>
                    <div>
                      <h3 className="font-semibold text-white">{s.name}</h3>
                      <p className="text-[11px] text-white/45">{s.phone}</p>
                    </div>
                  </div>
                  <div className="flex flex-col items-end gap-1">
                    <span className="rounded-md border border-white/10 bg-white/5 px-2 py-0.5 text-[11px] font-mono font-semibold text-white/80">
                      {s.terminal} · {s.room}
                    </span>
                    <span
                      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider ${
                        isCritical
                          ? "bg-red-500/20 text-red-300"
                          : isFlagged
                          ? "bg-amber-500/20 text-amber-300"
                          : "bg-emerald-500/15 text-emerald-400"
                      }`}
                    >
                      <span className={`h-1.5 w-1.5 rounded-full ${isCritical ? "bg-red-400" : isFlagged ? "bg-amber-400" : "bg-emerald-400"}`} />
                      {s.status}
                    </span>
                  </div>
                </div>

                {/* Exam info */}
                <div className="mt-4 rounded-xl border border-white/5 bg-black/25 p-3">
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-semibold text-white/90 truncate">{s.examTitle}</span>
                    <span className="rounded bg-emerald-500/10 px-1.5 py-0.5 text-[10px] font-bold text-emerald-400">
                      {s.examType}
                    </span>
                  </div>
                  <div className="mt-2 flex items-center justify-between text-[11px] text-white/60">
                    <span className="truncate">Section: <strong className="text-white/85">{s.currentSection}</strong></span>
                    <span className="font-mono text-white/70">{formatSec(s.timeElapsedSeconds)} / {formatSec(s.timeLimitSeconds)}</span>
                  </div>
                  {/* Progress bar */}
                  <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-white/10">
                    <div
                      className={`h-full rounded-full transition-all duration-500 ${
                        isCritical ? "bg-red-500" : isFlagged ? "bg-amber-500" : "bg-gradient-to-r from-emerald-500 to-[#10B981]"
                      }`}
                      style={{ width: `${progressPercent}%` }}
                    />
                  </div>
                </div>

                {/* Anti-cheat flags overview */}
                <div className="mt-3 grid grid-cols-4 gap-1.5 text-center">
                  <div className={`rounded-lg border p-1.5 ${s.antiCheatFlags.blurCount > 0 ? "border-amber-500/40 bg-amber-500/10 text-amber-300" : "border-white/5 bg-white/[0.02] text-white/40"}`}>
                    <p className="text-[10px] uppercase">Blur</p>
                    <p className="text-xs font-bold">{s.antiCheatFlags.blurCount}x</p>
                  </div>
                  <div className={`rounded-lg border p-1.5 ${s.antiCheatFlags.shortcutCount > 0 ? "border-amber-500/40 bg-amber-500/10 text-amber-300" : "border-white/5 bg-white/[0.02] text-white/40"}`}>
                    <p className="text-[10px] uppercase">Keys</p>
                    <p className="text-xs font-bold">{s.antiCheatFlags.shortcutCount}x</p>
                  </div>
                  <div className={`rounded-lg border p-1.5 ${s.antiCheatFlags.pasteCount > 0 ? "border-amber-500/40 bg-amber-500/10 text-amber-300" : "border-white/5 bg-white/[0.02] text-white/40"}`}>
                    <p className="text-[10px] uppercase">Paste</p>
                    <p className="text-xs font-bold">{s.antiCheatFlags.pasteCount}x</p>
                  </div>
                  <div className={`rounded-lg border p-1.5 ${s.antiCheatFlags.multiMonitorAlert ? "border-red-500/40 bg-red-500/10 text-red-300" : "border-white/5 bg-white/[0.02] text-white/40"}`}>
                    <p className="text-[10px] uppercase">Monitors</p>
                    <p className="text-xs font-bold">{s.antiCheatFlags.multiMonitorAlert ? "MULTI" : "1 OK"}</p>
                  </div>
                </div>
              </div>

              {/* Actions */}
              <div className="mt-4 flex items-center gap-2 border-t border-white/5 pt-3">
                <button
                  type="button"
                  onClick={() => setSelectedStudent(s)}
                  className="flex-1 rounded-xl border border-white/10 bg-surface py-2 text-xs font-semibold text-white/80 transition hover:bg-surface-hover hover:text-white"
                >
                  Audit Logs ({totalFlags})
                </button>
                <button
                  type="button"
                  onClick={() => setWarningModalStudent(s)}
                  className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs font-semibold text-amber-300 transition hover:bg-amber-500/20"
                >
                  Warn
                </button>
                <button
                  type="button"
                  onClick={() => handleTerminate(s)}
                  title="Terminate Attempt"
                  className="rounded-xl border border-red-500/30 bg-red-500/10 p-2 text-xs text-red-400 transition hover:bg-red-500/20 hover:text-red-300"
                >
                  <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
            </div>
          );
        })}
      </div>

      {filtered.length === 0 && (
        <div className="card rounded-2xl p-12 text-center text-white/50">
          <p className="text-base font-semibold text-white">No active exam sessions matching your filter</p>
          <p className="mt-1 text-xs">Try clearing your search query or selecting "All" statuses.</p>
        </div>
      )}

      {/* Incident Log Modal */}
      {selectedStudent && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 backdrop-blur-md">
          <div className="card w-full max-w-lg rounded-3xl border border-white/15 p-6 shadow-2xl">
            <div className="flex items-start justify-between">
              <div>
                <h3 className="text-lg font-bold text-white">{selectedStudent.name}</h3>
                <p className="text-xs text-white/50">{selectedStudent.terminal} · {selectedStudent.room} · {selectedStudent.examTitle}</p>
              </div>
              <button
                type="button"
                onClick={() => setSelectedStudent(null)}
                className="rounded-lg p-1 text-white/50 hover:bg-white/10 hover:text-white"
              >
                ✕
              </button>
            </div>

            <div className="mt-5 space-y-2">
              <p className="text-xs font-semibold uppercase tracking-wider text-white/40">Real-time Anti-cheat Event Timeline</p>
              {selectedStudent.antiCheatFlags.events.length === 0 ? (
                <div className="rounded-xl border border-white/10 bg-white/[0.02] p-6 text-center text-xs text-white/50">
                  ✓ Clean attempt. No focus loss or violation events detected.
                </div>
              ) : (
                <div className="max-h-60 space-y-2 overflow-y-auto pr-1">
                  {selectedStudent.antiCheatFlags.events.map((ev, i) => (
                    <div
                      key={i}
                      className={`flex items-start justify-between rounded-xl border p-3 text-xs ${
                        ev.severity === "high"
                          ? "border-red-500/40 bg-red-950/20 text-red-200"
                          : ev.severity === "medium"
                          ? "border-amber-500/30 bg-amber-950/15 text-amber-200"
                          : "border-white/10 bg-white/[0.03] text-white/80"
                      }`}
                    >
                      <div>
                        <span className="font-semibold uppercase tracking-wider">{ev.kind}</span>
                        <p className="mt-0.5 text-[11px] text-white/70">{ev.description}</p>
                      </div>
                      <span className="font-mono text-[10px] text-white/50">{ev.time}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="mt-6 flex items-center justify-between border-t border-white/10 pt-4">
              <button
                type="button"
                onClick={() => handleClearFlags(selectedStudent.id)}
                className="rounded-xl border border-white/10 bg-surface px-4 py-2 text-xs font-semibold text-white/70 hover:bg-surface-hover hover:text-white"
              >
                Reset Flags
              </button>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setWarningModalStudent(selectedStudent);
                    setSelectedStudent(null);
                  }}
                  className="rounded-xl border border-amber-500/30 bg-amber-500/20 px-4 py-2 text-xs font-semibold text-amber-300 hover:bg-amber-500/30"
                >
                  Send Warning
                </button>
                <button
                  type="button"
                  onClick={() => setSelectedStudent(null)}
                  className="rounded-xl bg-emerald-500 px-4 py-2 text-xs font-bold text-white hover:bg-emerald-600"
                >
                  Done
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Warning Message Modal */}
      {warningModalStudent && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 backdrop-blur-md">
          <form onSubmit={handleSendWarning} className="card w-full max-w-md rounded-3xl border border-white/15 p-6 shadow-2xl">
            <h3 className="text-lg font-bold text-white">Send Proctor Warning</h3>
            <p className="mt-1 text-xs text-white/50">
              Transmit an immediate overlay alert to <strong className="text-white">{warningModalStudent.name}</strong> at <strong className="text-emerald-400">{warningModalStudent.terminal}</strong>.
            </p>

            <div className="mt-4 space-y-2">
              <label className="text-[11px] font-medium uppercase tracking-wider text-white/40">Warning Message</label>
              <textarea
                required
                rows={3}
                value={warningMessage}
                onChange={(e) => setWarningMessage(e.target.value)}
                placeholder="E.g., Window blur detected. Please stay focused on your exam screen or your attempt will be flagged."
                className="w-full rounded-xl border border-white/10 bg-surface/80 p-3 text-xs text-white placeholder-white/30 focus:border-amber-400 focus:outline-none"
              />
              <div className="flex flex-wrap gap-1.5 pt-1">
                {[
                  "Stay focused on the exam window.",
                  "Multiple window blurs flagged.",
                  "Secondary display prohibited.",
                ].map((preset) => (
                  <button
                    key={preset}
                    type="button"
                    onClick={() => setWarningMessage(preset)}
                    className="rounded-lg border border-white/10 bg-white/5 px-2 py-1 text-[10px] text-white/70 hover:bg-white/10 hover:text-white"
                  >
                    {preset}
                  </button>
                ))}
              </div>
            </div>

            <div className="mt-6 flex items-center justify-end gap-2 border-t border-white/10 pt-4">
              <button
                type="button"
                onClick={() => setWarningModalStudent(null)}
                className="rounded-xl border border-white/10 bg-surface px-4 py-2 text-xs font-semibold text-white/70 hover:bg-surface-hover hover:text-white"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="rounded-xl bg-amber-500 px-4 py-2 text-xs font-bold text-black hover:bg-amber-400"
              >
                Transmit Warning
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
