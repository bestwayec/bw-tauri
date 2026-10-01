import { useState } from "react";
import pkg from "../../package.json";
import { API_BASE_URL, isApiMisconfigured, isLoopbackUrl, isProdBuild, me } from "@/lib/api";
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

/**
 * Student settings — only controls that really work in this client.
 * No backend/API/technical details: this is an exam app, not a control panel.
 */
export default function Settings({ studentName, studentPhone, onLogout }: Props) {
  const [confirmSubmit, setConfirmSubmit] = useState(() => getConfirmBeforeSubmit());
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<string | null>(null);
  const [testOk, setTestOk] = useState(false);
  const initial = ((studentName ?? "?").trim().charAt(0).toUpperCase() || "?");

  function handleConfirmToggle(next: boolean) {
    setConfirmSubmit(next);
    setConfirmBeforeSubmit(next);
  }

  /** Connection test: authenticated GET /auth/me with timing. */
  async function testConnection() {
    setTesting(true);
    setTestResult(null);
    const t0 = performance.now();
    try {
      const profile = await me();
      const ms = Math.round(performance.now() - t0);
      const id = typeof profile?.user?.id === "string" ? profile.user.id.slice(0, 8) : "?";
      const role = typeof profile?.user?.role === "string" ? profile.user.role : "?";
      setTestOk(true);
      setTestResult(`OK ${ms}ms · user ${id}… (${role}) · ${API_BASE_URL}`);
    } catch (e) {
      const err = e as { code?: unknown; message?: unknown; status?: unknown };
      const code = typeof err?.code === "string" ? err.code : "ERROR";
      const status = typeof err?.status === "number" ? ` [${err.status}]` : "";
      const msg = typeof err?.message === "string" && err.message ? err.message : "Request failed";
      setTestOk(false);
      setTestResult(`${code}${status}: ${msg} · ${API_BASE_URL}`);
    } finally {
      setTesting(false);
    }
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
            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-gradient-to-br from-brand/30 to-sky-400/20 text-sm font-bold text-brand-subtle-fg ring-1 ring-white/15">
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

        {/* Connection — which backend this client talks to */}
        <div className="card rounded-2xl p-5">
          <h2 className="text-sm font-bold text-white">Connection</h2>
          <div className="mt-3 rounded-xl bg-black/30 px-3.5 py-3 ring-1 ring-white/10">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-white/35">Backend API</p>
            <p className="mt-1 break-all font-mono text-xs text-white/80">{API_BASE_URL}</p>
            <p className="mt-1 font-mono text-[11px] text-white/40">
              {isProdBuild() ? "production build" : "dev build"}
              {isLoopbackUrl(API_BASE_URL) ? " · loopback" : " · remote"}
            </p>
          </div>
          {isApiMisconfigured() && (
            <p role="alert" className="mt-2 rounded-xl border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs leading-relaxed text-red-300">
              This installed app points at localhost, so it cannot reach the real backend.
              Tell your administrator — the app needs a production build with the backend URL.
            </p>
          )}
          <button
            type="button"
            onClick={() => void testConnection()}
            disabled={testing}
            className="btn-ghost mt-3 w-full rounded-xl px-4 py-2.5 text-sm font-medium text-white disabled:opacity-50"
          >
            {testing ? "Testing…" : "Test connection"}
          </button>
          {testResult && (
            <p className={`mt-2 rounded-xl px-3 py-2 font-mono text-[11px] leading-relaxed ring-1 ${testOk ? "bg-brand-subtle text-brand-subtle-fg ring-brand/30" : "bg-red-500/10 text-red-300 ring-red-500/30"}`}>
              {testResult}
            </p>
          )}
        </div>

        {/* About — non-technical product info only */}
        <div className="card rounded-2xl p-5 xl:col-span-2">
          <div className="flex flex-wrap items-center gap-3">
            <div className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-brand to-accent text-base font-black text-black">
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
