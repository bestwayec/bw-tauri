import { useState } from "react";
import { clearSession, login } from "@/lib/api";

type Props = {
  open: boolean;
  phone: string | null;
  onDone: () => void;
};

/**
 * Mid-exam re-login: shown OVER the attempt when the session definitively
 * expired (answers + queue stay intact). Phone is prefilled; a successful
 * password sign-in resumes the same attempt in place — never navigates away.
 */
export default function ReauthModal({ open, phone, onDone }: Props) {
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!open) return null;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!phone || !password || busy) return;
    setBusy(true);
    setError(null);
    try {
      const session = await login(phone, password);
      const role = String(session.user?.role ?? "");
      if (role !== "student" || !session.user?.id) {
        await clearSession();
        setError(role !== "student" ? "This app is for students only." : "Sign-in failed. Please try again.");
        setBusy(false);
        return;
      }
      setPassword("");
      onDone();
    } catch (err) {
      const apiErr = err as { code?: string; message?: string } | null;
      setError(
        typeof apiErr?.message === "string" && apiErr.message
          ? (apiErr.code ? `${apiErr.message} (${apiErr.code})` : apiErr.message)
          : "Login failed. Check password.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="exam-shell" data-exam-theme="light">
      <div className="exam-help" role="dialog" aria-label="Sign in again" aria-modal="true">
      <form onSubmit={submit} className="exam-help-card">
        <h2>Session expired</h2>
        <p className="mt-1 text-xs leading-relaxed" style={{ color: "var(--ex-muted)" }}>
          Your answers are safe and queued. Sign in again to keep going — the exam stays exactly where it was.
        </p>
        <label className="mt-3 block text-xs font-semibold">
          Phone
          <input value={phone ?? ""} disabled aria-label="Phone number" className="exam-input mt-1" />
        </label>
        <label className="mt-2 block text-xs font-semibold">
          Password
          <input
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            type="password"
            autoComplete="current-password"
            autoFocus
            aria-label="Password"
            className="exam-input mt-1"
          />
        </label>
        {error && (
          <p role="alert" className="mt-2 text-xs" style={{ color: "var(--ex-danger)" }}>
            {error}
          </p>
        )}
        <button type="submit" disabled={busy || !password} className="exam-btn-primary mt-3 w-full">
          {busy ? "Signing in…" : "Sign in & resume"}
        </button>
      </form>
      </div>
    </div>
  );
}
