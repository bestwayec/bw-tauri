import { useEffect, useState } from "react";

/**
 * Webview crash recovery: counts uncaught errors/rejections in a rolling
 * 30s window and offers a one-click reload once they pile up (3+), instead
 * of leaving the student on a dead screen. Answers already autosaved to the
 * server or the offline queue survive a reload; in-exam timers are
 * server-deadline based, so the attempt resumes where it was.
 */
export default function CrashRecovery() {
  const [tripped, setTripped] = useState(false);

  useEffect(() => {
    let hits: number[] = [];
    const note = () => {
      const now = Date.now();
      hits = [...hits.filter((t) => now - t < 30_000), now];
      if (hits.length >= 3) setTripped(true);
    };
    const onError = () => note();
    const onRejection = (e: PromiseRejectionEvent) => {
      // Ignore aborts from timers/fetches torn down during navigation.
      if (e?.reason instanceof DOMException && e.reason.name === "AbortError") return;
      note();
    };
    window.addEventListener("error", onError);
    window.addEventListener("unhandledrejection", onRejection);
    return () => {
      window.removeEventListener("error", onError);
      window.removeEventListener("unhandledrejection", onRejection);
    };
  }, []);

  if (!tripped) return null;
  return (
    <div
      role="alertdialog"
      aria-label="App recovery"
      className="fixed inset-0 z-[90] grid place-items-center bg-black/80 p-6"
    >
      <div className="card w-full max-w-sm rounded-2xl p-6 text-center">
        <p className="text-lg font-bold text-white">Something went wrong</p>
        <p className="mt-1 text-sm text-white/55">
          Your saved answers are safe. Reload to continue — an exam in progress resumes automatically.
        </p>
        <button
          type="button"
          onClick={() => window.location.reload()}
          className="btn-brand mt-4 w-full rounded-xl px-4 py-2.5 text-sm font-bold"
        >
          Reload app
        </button>
      </div>
    </div>
  );
}
