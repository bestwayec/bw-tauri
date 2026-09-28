import { useState } from "react";
import pkg from "../../package.json";
import { getConfirmBeforeSubmit, setConfirmBeforeSubmit } from "@/lib/exam-prefs";

type Props = {
  studentName: string | null;
  studentPhone: string | null;
  onLogout: () => void;
};

function Toggle({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  label: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={`relative h-6 w-11 shrink-0 rounded-full transition ${
        checked ? "bg-[#19D36B]" : "bg-white/15"
      }`}
    >
      <span
        className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all ${
          checked ? "left-[22px]" : "left-0.5"
        }`}
      />
    </button>
  );
}

/**
 * Student settings — only controls that really work in this client.
 * No backend/API/technical details: this is an exam app, not a control panel.
 */
export default function Settings({ studentName, studentPhone, onLogout }: Props) {
  const [confirmSubmit, setConfirmSubmit] = useState(() => getConfirmBeforeSubmit());
  const initial = ((studentName ?? "?").trim().charAt(0).toUpperCase() || "?");

  function handleConfirmToggle(next: boolean) {
    setConfirmSubmit(next);
    setConfirmBeforeSubmit(next);
  }

  return (
    <section>
      <h1 className="text-xl font-bold tracking-tight">Settings</h1>
      <p className="mt-1 text-sm text-white/50">Your exam preferences and account.</p>

      <div className="mt-4 grid items-start gap-3 xl:grid-cols-2">
        {/* Exam experience — every control below is wired to real behavior */}
        <div className="card rounded-2xl p-5">
          <h2 className="text-sm font-bold text-white">Exam experience</h2>
          <div className="mt-3 flex items-center gap-3 rounded-xl bg-black/30 px-3.5 py-3 ring-1 ring-white/10">
            <div className="min-w-0 flex-1">
              <p className="text-[13px] font-semibold text-white">Confirm before submitting</p>
              <p className="mt-0.5 text-xs leading-relaxed text-white/40">
                {confirmSubmit
                  ? "The app asks you to confirm before an exam is submitted."
                  : "Exams submit immediately with no confirmation step."}
              </p>
            </div>
            <Toggle checked={confirmSubmit} onChange={handleConfirmToggle} label="Confirm before submitting" />
          </div>
          <p className="mt-2 text-[11px] leading-relaxed text-white/30">
            Answers save automatically while you work — this only controls the final submit step.
          </p>
        </div>

        {/* Account — real signed-in student data */}
        <div className="card rounded-2xl p-5">
          <h2 className="text-sm font-bold text-white">Account</h2>
          <div className="mt-3 flex items-center gap-3 rounded-xl bg-black/30 px-3.5 py-3 ring-1 ring-white/10">
            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-gradient-to-br from-emerald-400/30 to-sky-400/20 text-sm font-bold text-emerald-200 ring-1 ring-white/15">
              {initial}
            </span>
            <div className="min-w-0">
              <p className="truncate text-[13px] font-semibold text-white">
                {studentName ?? "Student"}
              </p>
              {studentPhone && (
                <p className="mt-0.5 font-mono text-[11px] text-white/45">{studentPhone}</p>
              )}
            </div>
          </div>
          <button
            type="button"
            onClick={onLogout}
            className="btn-ghost mt-3 flex w-full items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-medium text-red-300 hover:text-red-200"
          >
            Log out
          </button>
        </div>

        {/* About — non-technical product info only */}
        <div className="card rounded-2xl p-5 xl:col-span-2">
          <div className="flex flex-wrap items-center gap-3">
            <div className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-emerald-400 to-emerald-600 text-base font-black text-black">
              B
            </div>
            <div className="min-w-0">
              <p className="text-sm font-bold text-white">Bestway Exam</p>
              <p className="font-mono text-[11px] text-white/40">Version {pkg.version}</p>
            </div>
          </div>
          <p className="mt-3 max-w-2xl text-xs leading-relaxed text-white/40">
            Your IELTS exam application. Take assigned listening, reading, writing and
            speaking exams, track your scores in History, and stay online during exams
            so your answers sync safely.
          </p>
        </div>
      </div>
    </section>
  );
}
