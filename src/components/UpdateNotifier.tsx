import { useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { openInBrowser } from "@/lib/oauth";
import { dismissVersion, type UpdateInfo } from "@/lib/version";
import { isSafeHttpUrl } from "@/lib/secure-storage";

type Props = {
  update: UpdateInfo;
  onClose: () => void;
  /**
   * True while an exam attempt is on screen. The install/relaunch button is
   * hidden so an update can NEVER restart the app mid-exam; the toast simply
   * waits until the exam ends (the update check itself already ran).
   */
  deferInstall?: boolean;
};

type Status = "idle" | "checking" | "downloading" | "installing" | "opening" | "error";

/**
 * Version-update toast, top-right — same structure as the reference
 * Announcement card (leading icon, dismiss, title, description, full-width
 * secondary CTA), restyled to the app's dark + brand identity.
 *
 * Update flow: tries the signed Tauri updater (`check()` →
 * `downloadAndInstall()` → relaunch) first so binary authenticity is
 * verified via `plugins.updater.pubkey`. Falls back to manual
 * `openInBrowser(downloadUrl)` (still gated by `isSafeHttpUrl`) when the
 * updater is unavailable (browser dev, offline, no update found).
 *
 * Dismissal plays a soft blur + scale-down exit via motion, persists the
 * dismissed version (same version never nags twice), then unmounts.
 */
export default function UpdateNotifier({ update, onClose, deferInstall }: Props) {
  const [dismissed, setDismissed] = useState(false);
  const [status, setStatus] = useState<Status>("idle");
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const close = () => {
    dismissVersion(update.latest);
    setDismissed(true);
  };

  const busy = status === "checking" || status === "downloading" || status === "installing" || status === "opening";

  const openManually = async () => {
    if (!update.downloadUrl) return;
    if (!isSafeHttpUrl(update.downloadUrl)) return;
    setStatus("opening");
    try {
      await openInBrowser(update.downloadUrl);
    } catch {
      /* opener already fell back to a tab; nothing more to do */
    } finally {
      setStatus("idle");
    }
  };

  const handleAction = async () => {
    if (busy) return;
    setError(null);
    setProgress(null);
    // Prefer the signed in-place updater; keep manual open as fallback.
    try {
      setStatus("checking");
      const updater = await import("@tauri-apps/plugin-updater");
      const found = await updater.check();
      if (found) {
        setStatus("downloading");
        await found.downloadAndInstall((e) => {
          if (e.event === "Started") setProgress(0);
          else if (e.event === "Progress") {
            try {
              const chunk = (e.data as { chunkLength?: number }).chunkLength ?? 0;
              setProgress((p) => Math.min(99, (p ?? 0) + Math.max(1, Math.round(chunk / 1024))));
            } catch {
              /* ignore */
            }
          } else if (e.event === "Finished") setProgress(100);
        });
        setStatus("installing");
        const proc = await import("@tauri-apps/plugin-process");
        await proc.relaunch();
        return;
      }
    } catch {
      // Not in Tauri runtime, updater disabled, or check failed —
      // fall through to the manual download path below.
    }
    // Fallback: manual download in the system browser (defense-in-depth:
    // isSafeHttpUrl re-validated here even though version.ts already nulled
    // unsafe URLs at fetch time).
    if (!update.downloadUrl) {
      setError("No download available for this update.");
      setStatus("error");
      return;
    }
    if (!isSafeHttpUrl(update.downloadUrl)) {
      setError("Blocked unsafe download URL.");
      setStatus("error");
      return;
    }
    await openManually();
  };

  const label =
    status === "checking"
      ? "Checking…"
      : status === "downloading"
        ? progress != null
          ? `Downloading… ${progress}%`
          : "Downloading…"
        : status === "installing"
          ? "Installing…"
          : status === "opening"
            ? "Opening…"
            : "Update now";

  return (
    <div
      role="region"
      aria-label="Application update available"
      className="pointer-events-none fixed right-4 top-4 z-[70] w-[320px] max-w-[calc(100vw-2rem)]"
    >
      <AnimatePresence onExitComplete={onClose}>
        {!dismissed && (
          <motion.div
            initial={{ opacity: 0, y: -12, scale: 0.95, filter: "blur(6px)" }}
            animate={{
              opacity: 1,
              y: 0,
              scale: 1,
              filter: "blur(0px)",
              transition: { duration: 0.25, ease: "easeOut", delay: 0.35 },
            }}
            exit={{
              opacity: 0,
              scale: 0.85,
              filter: "blur(6px)",
              transition: { duration: 0.25, ease: "easeInOut" },
            }}
            className="card pointer-events-auto relative flex w-full flex-col items-start gap-3 rounded-xl border-white/10 bg-black/70 p-3 shadow-[0_16px_50px_rgba(0,0,0,0.55)] backdrop-blur-xl"
          >
            <div className="flex w-full flex-col items-start gap-1">
              <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-brand/10 text-brand ring-1 ring-brand/25">
                <svg
                  width="18"
                  height="18"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                  <path d="m7 10 5 5 5-5" />
                  <path d="M12 15V3" />
                </svg>
              </span>

              <button
                type="button"
                aria-label="Dismiss update notification"
                onClick={close}
                className="absolute right-2.5 top-2.5 grid h-6 w-6 place-items-center rounded-md text-white/40 transition hover:bg-white/5 hover:text-white"
              >
                <svg
                  width="13"
                  height="13"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <path d="M18 6 6 18" />
                  <path d="m6 6 12 12" />
                </svg>
              </button>

              <div className="flex w-full flex-col items-start">
                <p className="w-full text-sm font-semibold text-white">New version available</p>
                <p className="mt-0.5 w-full text-[13px] leading-snug text-white/55">
                  Bestway Exam {update.latest} is ready — you&apos;re on {update.current}.
                </p>
              </div>
            </div>

            {deferInstall ? (
              <p className="w-full text-xs leading-snug text-white/50">
                An exam is in progress — the update will install after you finish. Nothing restarts meanwhile.
              </p>
            ) : (
              (update.downloadUrl || status !== "idle") && (
                <button
                  type="button"
                  onClick={() => void handleAction()}
                  disabled={busy}
                  className="btn-ghost w-full rounded-lg px-3 py-2 text-[13px] font-semibold text-white disabled:opacity-60"
                >
                  {label}
                </button>
              )
            )}
            {status === "downloading" && progress != null && (
              <div
                className="h-1 w-full overflow-hidden rounded-full bg-white/10"
                role="progressbar"
                aria-valuenow={progress}
                aria-valuemin={0}
                aria-valuemax={100}
              >
                <div className="h-full bg-brand transition-all" style={{ width: `${progress}%` }} />
              </div>
            )}
            {error && (
              <p role="alert" className="w-full text-xs leading-snug text-red-300">
                {error}
              </p>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
