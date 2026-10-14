import { useState } from "react";
import type { Route } from "@/App";

interface LabStatus {
  id: string;
  name: string;
  totalSeats: number;
  occupiedSeats: number;
  currentExam: string;
  proctorName: string;
  status: "in_session" | "preparing" | "idle";
}

const LABS_DATA: LabStatus[] = [
  {
    id: "lab-101",
    name: "Testing Lab 101 (Main)",
    totalSeats: 25,
    occupiedSeats: 24,
    currentExam: "IELTS Academic Mock #14",
    proctorName: "Anvar Ruziyev",
    status: "in_session",
  },
  {
    id: "lab-102",
    name: "Testing Lab 102 (West)",
    totalSeats: 20,
    occupiedSeats: 18,
    currentExam: "CEFR Multilevel Standard Exam #08",
    proctorName: "Dilshod Aliyev",
    status: "in_session",
  },
  {
    id: "lab-103",
    name: "Speaking Lab 103",
    totalSeats: 15,
    occupiedSeats: 12,
    currentExam: "IELTS Speaking One-on-One Recording",
    proctorName: "Nodira Karimova",
    status: "in_session",
  },
  {
    id: "lab-104",
    name: "Testing Lab 104 (East)",
    totalSeats: 30,
    occupiedSeats: 0,
    currentExam: "Next Session Scheduled at 16:00",
    proctorName: "System Ready",
    status: "idle",
  },
];

type Props = {
  onNavigate: (route: Route) => void;
};

export default function CenterOverview({ onNavigate }: Props) {
  const [labs] = useState<LabStatus[]>(LABS_DATA);
  const [broadcastOpen, setBroadcastOpen] = useState(false);
  const [broadcastText, setBroadcastText] = useState("");
  const [toast, setToast] = useState<string | null>(null);

  function triggerToast(msg: string) {
    setToast(msg);
    setTimeout(() => setToast(null), 3000);
  }

  function handleBroadcast(e: React.FormEvent) {
    e.preventDefault();
    if (!broadcastText) return;
    triggerToast(`Broadcast transmitted to all 3 active labs: "${broadcastText}"`);
    setBroadcastText("");
    setBroadcastOpen(false);
  }

  const activeSeats = labs.reduce((sum, l) => sum + l.occupiedSeats, 0);
  const totalSeats = labs.reduce((sum, l) => sum + l.totalSeats, 0);

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
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold tracking-tight text-white">Center Administration Hub</h1>
            <span className="rounded-full border border-emerald-500/30 bg-emerald-500/10 px-3 py-0.5 text-xs font-semibold text-emerald-400">
              Bestway Central HQ
            </span>
          </div>
          <p className="mt-1 text-xs text-white/50">
            Real-time center telemetry, computer labs management, exam distribution & security oversight.
          </p>
        </div>

        {/* Action buttons */}
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setBroadcastOpen(true)}
            className="flex items-center gap-2 rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-2 text-xs font-bold text-emerald-300 transition hover:bg-emerald-500/20"
          >
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5.882V19.24a1.76 1.76 0 01-3.417.592l-2.147-6.15M18 13a3 3 0 100-6M5.436 13.683A4.001 4.001 0 017 6h1.832c4.1 0 7.625-1.234 9.168-3v14c-1.543-1.766-5.067-3-9.168-3H7a3.988 3.988 0 01-1.564-.317z" />
            </svg>
            Broadcast to Labs
          </button>
          <button
            type="button"
            onClick={() => onNavigate("proctoring")}
            className="btn-brand px-4 py-2 text-xs font-bold"
          >
            Open Live Proctoring
          </button>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <div className="card rounded-2xl p-4">
          <p className="text-xs font-medium uppercase tracking-wider text-white/40">Active Test Takers</p>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="text-3xl font-extrabold text-emerald-400">{activeSeats}</span>
            <span className="text-xs text-white/40">/ {totalSeats} seats</span>
          </div>
          <div className="mt-2 flex items-center gap-1.5 text-[11px] text-emerald-400">
            <span className="h-2 w-2 animate-ping rounded-full bg-emerald-400" />
            Across 3 active labs
          </div>
        </div>

        <div className="card rounded-2xl p-4">
          <p className="text-xs font-medium uppercase tracking-wider text-white/40">Tests Today</p>
          <p className="mt-2 text-3xl font-extrabold text-white">114</p>
          <p className="mt-2 text-[11px] text-emerald-400/80">98.2% completion rate</p>
        </div>

        <div className="card rounded-2xl p-4">
          <p className="text-xs font-medium uppercase tracking-wider text-white/40">Security Incidents</p>
          <p className="mt-2 text-3xl font-extrabold text-amber-400">3</p>
          <p className="mt-2 text-[11px] text-amber-300/80">2 blurs, 1 shortcut blocked</p>
        </div>

        <div className="card rounded-2xl p-4">
          <p className="text-xs font-medium uppercase tracking-wider text-white/40">Kiosk Integrity</p>
          <p className="mt-2 text-3xl font-extrabold text-emerald-400">100%</p>
          <p className="mt-2 text-[11px] text-white/40">WH_KEYBOARD_LL active</p>
        </div>
      </div>

      {/* Testing Labs Live Status */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-bold text-white">Testing Rooms & Labs Overview</h2>
          <span className="text-xs text-white/50">4 total computer labs</span>
        </div>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          {labs.map((lab) => {
            const isFull = lab.occupiedSeats >= lab.totalSeats;
            const pct = Math.round((lab.occupiedSeats / lab.totalSeats) * 100);
            return (
              <div
                key={lab.id}
                className="card rounded-2xl border border-white/10 p-5 transition duration-150 hover:border-emerald-500/30"
              >
                <div className="flex items-start justify-between">
                  <div>
                    <h3 className="font-bold text-white">{lab.name}</h3>
                    <p className="text-xs text-white/50">Proctor: <strong className="text-white/80">{lab.proctorName}</strong></p>
                  </div>
                  <span
                    className={`rounded-full px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider ${
                      lab.status === "in_session"
                        ? "bg-emerald-500/20 text-emerald-300"
                        : "bg-white/10 text-white/60"
                    }`}
                  >
                    {lab.status === "in_session" ? "Active Exam" : "Idle / Next Session"}
                  </span>
                </div>

                <div className="mt-4 rounded-xl border border-white/5 bg-black/25 p-3">
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-white/70 truncate">{lab.currentExam}</span>
                    <span className="font-mono font-bold text-white">
                      {lab.occupiedSeats} / {lab.totalSeats} seats ({pct}%)
                    </span>
                  </div>
                  <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-white/10">
                    <div
                      className={`h-full rounded-full transition-all duration-500 ${
                        isFull ? "bg-amber-400" : "bg-gradient-to-r from-emerald-500 to-[#89F336]"
                      }`}
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                </div>

                <div className="mt-4 flex items-center justify-between border-t border-white/5 pt-3 text-xs">
                  <span className="text-white/40">Lockdown: <strong className="text-emerald-400 font-mono">ENFORCED</strong></span>
                  <button
                    type="button"
                    onClick={() => onNavigate("proctoring")}
                    className="font-semibold text-emerald-400 hover:text-emerald-300"
                  >
                    View Terminals →
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Security & Program Breakdown Bottom Grid */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Anti-cheat & Kiosk Security Audit */}
        <div className="card rounded-2xl border border-white/10 p-5">
          <h3 className="font-bold text-white">Anti-Cheat & Station Security Standards</h3>
          <p className="mt-1 text-xs text-white/50">Desktop hardware hardening and OS-level lockdown enforcement.</p>

          <div className="mt-4 space-y-3">
            {[
              {
                title: "Windows WH_KEYBOARD_LL Low-Level Hook",
                desc: "Swallows Windows key, Alt+Tab, Alt+F4, and Ctrl+Shift+Esc on all candidate stations.",
                status: "Operational",
                badge: "Active",
              },
              {
                title: "Multi-Monitor Detection & Blocking",
                desc: "Rejects exam start if more than one physical monitor is attached to candidate PC.",
                status: "Enforced",
                badge: "Active",
              },
              {
                title: "Content & Screenshot Protection",
                desc: "Hardware accelerated window protection blocks Snipping Tool, OBS, and print-screen.",
                status: "Enforced",
                badge: "Active",
              },
              {
                title: "Clipboard Scrubbing on Engage",
                desc: "Automatically empties system clipboard buffer upon entering CBT exam session.",
                status: "Enforced",
                badge: "Active",
              },
            ].map((sec, i) => (
              <div key={i} className="flex items-start justify-between rounded-xl border border-white/5 bg-black/20 p-3 text-xs">
                <div>
                  <p className="font-semibold text-white">{sec.title}</p>
                  <p className="mt-0.5 text-[11px] text-white/50">{sec.desc}</p>
                </div>
                <span className="shrink-0 rounded-md bg-emerald-500/15 px-2 py-0.5 text-[10px] font-bold text-emerald-400">
                  {sec.badge}
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* Program Distribution */}
        <div className="card rounded-2xl border border-white/10 p-5">
          <div className="flex items-center justify-between">
            <h3 className="font-bold text-white">Exam Program Distribution</h3>
            <button
              type="button"
              onClick={() => onNavigate("studentResults")}
              className="text-xs font-semibold text-emerald-400 hover:text-emerald-300"
            >
              All Results →
            </button>
          </div>
          <p className="mt-1 text-xs text-white/50">Candidate enrollment by certification track.</p>

          <div className="mt-6 space-y-4">
            <div>
              <div className="flex justify-between text-xs font-semibold">
                <span className="text-white">IELTS Academic (IDP / BC Standards)</span>
                <span className="font-mono text-emerald-400">58% (66 candidates)</span>
              </div>
              <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-white/10">
                <div className="h-full rounded-full bg-emerald-500" style={{ width: "58%" }} />
              </div>
            </div>

            <div>
              <div className="flex justify-between text-xs font-semibold">
                <span className="text-white">CEFR Multilevel (UZBMB National Standard)</span>
                <span className="font-mono text-[#89F336]">32% (36 candidates)</span>
              </div>
              <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-white/10">
                <div className="h-full rounded-full bg-[#89F336]" style={{ width: "32%" }} />
              </div>
            </div>

            <div>
              <div className="flex justify-between text-xs font-semibold">
                <span className="text-white">IELTS General Training</span>
                <span className="font-mono text-cyan-400">10% (12 candidates)</span>
              </div>
              <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-white/10">
                <div className="h-full rounded-full bg-cyan-400" style={{ width: "10%" }} />
              </div>
            </div>
          </div>

          <div className="mt-8 rounded-xl border border-white/10 bg-white/[0.02] p-4 text-xs text-white/60">
            💡 <strong>Admin Notice:</strong> In Admin and Teacher desktop mode, exam lockdown is automatically disabled so you can multitask, use dual monitors, and manage exams without restrictions.
          </div>
        </div>
      </div>

      {/* Broadcast Modal */}
      {broadcastOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 backdrop-blur-md">
          <form onSubmit={handleBroadcast} className="card w-full max-w-md rounded-3xl border border-white/15 p-6 shadow-2xl">
            <h3 className="text-lg font-bold text-white">Broadcast Announcement to All Labs</h3>
            <p className="mt-1 text-xs text-white/50">
              Transmit an emergency or instructional alert banner to all active student screens in Labs 101, 102, and 103.
            </p>

            <div className="mt-4 space-y-2">
              <label className="text-[11px] font-medium uppercase tracking-wider text-white/40">Announcement Text</label>
              <textarea
                required
                rows={3}
                value={broadcastText}
                onChange={(e) => setBroadcastText(e.target.value)}
                placeholder="E.g., 10 minutes remaining in Section 2. Please make sure all objective answers are selected."
                className="w-full rounded-xl border border-white/10 bg-surface/80 p-3 text-xs text-white placeholder-white/30 focus:border-emerald-500 focus:outline-none"
              />
            </div>

            <div className="mt-6 flex items-center justify-end gap-2 border-t border-white/10 pt-4">
              <button
                type="button"
                onClick={() => setBroadcastOpen(false)}
                className="rounded-xl border border-white/10 bg-surface px-4 py-2 text-xs font-semibold text-white/70 hover:bg-surface-hover hover:text-white"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="btn-brand px-4 py-2 text-xs font-bold"
              >
                Transmit Broadcast
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
