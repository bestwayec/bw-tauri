import { useState } from "react";
import { getConfirmBeforeSubmit, setConfirmBeforeSubmit } from "@/lib/exam-prefs";

type Props = {
  name: string | null;
  phone: string | null;
  onLogout: () => void;
  stats?: { attempts: number; completed: number; avgScore: number | null } | null;
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
        checked ? "bg-[#89F336]" : "bg-white/15"
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

function LogoutIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
      <path d="m16 17 5-5-5-5" />
      <path d="M21 12H9" />
    </svg>
  );
}

/** Student profile: identity + stats + preferences + session — unified account page. */
export default function Profile({ name, phone, onLogout, stats }: Props) {
  const display = name ?? "Student";
  const initial = display.trim().charAt(0).toUpperCase() || "?";
  const [confirmSubmit, setConfirmSubmit] = useState(() => getConfirmBeforeSubmit());

  function handleConfirmToggle(next: boolean) {
    setConfirmSubmit(next);
    setConfirmBeforeSubmit(next);
  }
  return (
    <section className="mx-auto w-full max-w-[640px]">
      {/* Header */}
      <div className="text-center sm:text-left">
        <h1 className="text-xl font-bold tracking-tight text-white">Profile</h1>
        <p className="mt-1 text-sm text-white/50">Your account and app preferences.</p>
      </div>

      {/* Main profile account */}
      <div className="card relative mt-6 overflow-hidden rounded-2xl">
        <div className="pointer-events-none absolute -right-10 -top-10 h-40 w-40 rounded-full bg-brand/10 blur-2xl" aria-hidden="true" />
        <div className="p-6 sm:p-7">
          {/* Primary identity */}
          <div className="flex flex-col items-center gap-4 text-center sm:flex-row sm:items-center sm:text-left">
            <div className="grid h-16 w-16 shrink-0 place-items-center rounded-2xl bg-gradient-to-br from-brand to-accent text-2xl font-black text-black shadow-[0_0_32px_rgba(137, 243, 54,0.45)]">
              {initial}
            </div>
            <div className="min-w-0 flex-1">
              <h2 className="truncate text-xl font-bold leading-tight text-white" title={display}>
                {display}
              </h2>
              {phone && (
                <p className="mt-1 font-mono text-[13px] text-white/60">{phone}</p>
              )}
              <span className="mt-2 inline-flex items-center gap-1.5 rounded-full bg-brand/10 px-2.5 py-1 text-[11px] font-semibold text-brand-subtle-fg ring-1 ring-brand/30">
                <span className="h-1.5 w-1.5 rounded-full bg-brand" aria-hidden="true" />
                Student
              </span>
            </div>
          </div>

          {/* Divider */}
          <div className="my-6 h-px bg-white/[0.06]" aria-hidden="true" />

          {/* Secondary: Exam activity */}
          <div>
            <h3 className="text-[11px] font-bold uppercase tracking-[0.14em] text-white/45">Exam activity</h3>
            <div className="mt-3 grid grid-cols-3 gap-3">
              <div className="rounded-xl bg-black/30 px-3 py-4 text-center ring-1 ring-white/10">
                <p className="text-2xl font-black tabular-nums text-white">{stats?.attempts ?? "—"}</p>
                <p className="mt-1 text-[11px] font-medium uppercase tracking-widest text-white/40">Attempts</p>
              </div>
              <div className="rounded-xl bg-black/30 px-3 py-4 text-center ring-1 ring-white/10">
                <p className="text-2xl font-black tabular-nums text-white">{stats?.completed ?? "—"}</p>
                <p className="mt-1 text-[11px] font-medium uppercase tracking-widest text-white/40">Graded</p>
              </div>
              <div className="rounded-xl bg-black/30 px-3 py-4 text-center ring-1 ring-white/10">
                <p className="text-2xl font-black tabular-nums text-brand">
                  {stats?.avgScore == null ? "—" : Math.round(stats.avgScore * 10) / 10}
                </p>
                <p className="mt-1 text-[11px] font-medium uppercase tracking-widest text-white/40">Avg score</p>
              </div>
            </div>
            <p className="mt-2.5 text-center text-[11px] text-white/30 sm:text-left">
              Detailed stats load when you open History.
            </p>
          </div>

          {/* Divider */}
          <div className="my-6 h-px bg-white/[0.06]" aria-hidden="true" />

          {/* Preferences — moved from Settings */}
          <div>
            <h3 className="text-[11px] font-bold uppercase tracking-[0.14em] text-white/45">Preferences</h3>
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
            <p className="mt-2 text-center text-[11px] leading-relaxed text-white/30 sm:text-left">
              Answers save automatically while you work — this only controls the final submit step.
            </p>
          </div>
        </div>
      </div>

      {/* Bottom: Session — secondary, compact */}
      <div className="card mt-4 rounded-2xl p-5">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h3 className="text-sm font-semibold text-white">Session</h3>
            <p className="mt-0.5 text-xs text-white/40">This device only</p>
          </div>
          <button
            type="button"
            onClick={onLogout}
            className="inline-flex items-center gap-2 rounded-xl border border-white/10 bg-white/[0.04] px-4 py-2 text-sm font-medium text-white/80 transition hover:bg-white/[0.07] hover:text-white"
          >
            <LogoutIcon />
            Log out
          </button>
        </div>
        <p className="mt-3 border-t border-white/[0.06] pt-3 text-[11px] leading-relaxed text-white/30">
          Logging out clears tokens on this device only. Your progress remains on the server.
        </p>
      </div>
    </section>
  );
}
