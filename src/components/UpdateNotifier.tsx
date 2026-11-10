import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { openInBrowser } from "@/lib/oauth";
import { dismissVersion, probeDownloadUrl, takeSignedUpdate, type UpdateInfo } from "@/lib/version";
import { isSafeHttpUrl } from "@/lib/secure-storage";
import { getAppLanguage, onUiPrefsChange, type AppLanguage } from "@/lib/ui-prefs";

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

type Status = "idle" | "downloading" | "installing" | "opening" | "error";

const TEXT = {
  uz: {
    region: "Ilova yangilanishi mavjud",
    dismiss: "Yangilanish xabarini yopish",
    title: "Yangi versiya mavjud",
    body: (latest: string, current: string) =>
      `Bestway Exam ${latest} tayyor, sizda ${current} o'rnatilgan. Yuklab olish va yangilash uchun bosing.`,
    deferred: "Imtihon davom etmoqda — yangilanish imtihondan keyin o'rnatiladi. Hozir hech narsa qayta ishga tushmaydi.",
    action: "Yuklab olish va yangilash",
    downloading: "Yuklanmoqda…",
    installing: "O'rnatilmoqda…",
    opening: "Ochilmoqda…",
    failed: "Yangilanishni o'rnatib bo'lmadi. Keyinroq qayta urinib ko'ring.",
    noDownload: "Bu yangilanish uchun yuklab olish manzili yo'q.",
  },
  en: {
    region: "Application update available",
    dismiss: "Dismiss update notification",
    title: "New version available",
    body: (latest: string, current: string) =>
      `Bestway Exam ${latest} is ready, you're on ${current}. Click to download & update.`,
    deferred: "An exam is in progress — the update will install after you finish. Nothing restarts meanwhile.",
    action: "Download & update",
    downloading: "Downloading…",
    installing: "Installing…",
    opening: "Opening…",
    failed: "The update could not be installed. Please try again later.",
    noDownload: "No download available for this update.",
  },
} satisfies Record<AppLanguage, unknown>;

/**
 * Version-update toast, bottom-right (out of the way of the exam UI and the
 * toasts that live top-right), in the selected interface language.
 *
 * The toast is only mounted for an update that `resolveDesktopUpdate`
 * verified: either the signed updater found it (`source: "updater"`, the
 * version shown is the one in `latest.json`, installed in place and checked
 * against `plugins.updater.pubkey`), or the backend announced it and its
 * installer URL answered HEAD with 2xx (`source: "installer"`, opened in the
 * system browser). A missing installer never produces a toast.
 *
 * Dismissal plays a soft blur + scale-down exit via motion, persists the
 * dismissed version (same version never nags twice), then unmounts.
 */
export default function UpdateNotifier({ update, onClose, deferInstall }: Props) {
  const [dismissed, setDismissed] = useState(false);
  const [status, setStatus] = useState<Status>("idle");
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [lang, setLang] = useState<AppLanguage>(() => getAppLanguage());
  useEffect(() => onUiPrefsChange(() => setLang(getAppLanguage())), []);
  const t = TEXT[lang];

  const close = () => {
    dismissVersion(update.latest);
    setDismissed(true);
  };

  const busy = status === "downloading" || status === "installing" || status === "opening";
  const manualUrl = update.downloadUrl && isSafeHttpUrl(update.downloadUrl) ? update.downloadUrl : null;
  const signed = update.source === "updater" ? takeSignedUpdate() : null;
  const canAct = Boolean(signed || manualUrl);

  const openManually = async (url: string) => {
    setStatus("opening");
    try {
      const exists = await probeDownloadUrl(url);
      if (!exists) {
        console.warn("[updater] Installer URL returned 404/unreachable; suppressing browser open:", url);
        setError(t.failed);
        setStatus("error");
        return;
      }
      await openInBrowser(url);
      setStatus("idle");
    } catch (err) {
      console.warn("[updater] Could not open the installer URL:", err);
      setError(t.failed);
      setStatus("error");
    }
  };

  const handleAction = async () => {
    if (busy) return;
    setError(null);
    setProgress(null);
    if (signed) {
      try {
        setStatus("downloading");
        console.log(`[updater] Installing signed update ${signed.version}...`);
        let total = 0;
        let downloaded = 0;
        await signed.downloadAndInstall((e) => {
          if (e.event === "Started") {
            total = (e.data as { contentLength?: number })?.contentLength ?? 0;
            setProgress(0);
          } else if (e.event === "Progress") {
            downloaded += (e.data as { chunkLength?: number })?.chunkLength ?? 0;
            if (total > 0) setProgress(Math.min(99, Math.round((downloaded / total) * 100)));
            else setProgress((p) => Math.min(99, (p ?? 0) + 1));
          } else if (e.event === "Finished") {
            setProgress(100);
          }
        });
        setStatus("installing");
        const proc = await import("@tauri-apps/plugin-process");
        await proc.relaunch();
        return;
      } catch (err) {
        console.error("[updater] Signed update failed:", err);
        // A verified installer page is still a safe second route.
        if (manualUrl) {
          const exists = await probeDownloadUrl(manualUrl);
          if (exists) {
            await openManually(manualUrl);
            return;
          }
        }
        setError(t.failed);
        setStatus("error");
        return;
      }
    }
    if (!manualUrl) {
      setError(t.noDownload);
      setStatus("error");
      return;
    }
    await openManually(manualUrl);
  };

  const label =
    status === "downloading"
      ? progress != null
        ? `${t.downloading} ${progress}%`
        : t.downloading
      : status === "installing"
        ? t.installing
        : status === "opening"
          ? t.opening
          : t.action;

  return (
    <div
      role="region"
      aria-label={t.region}
      className="pointer-events-none fixed bottom-4 right-4 z-[70] w-[320px] max-w-[calc(100vw-2rem)]"
    >
      <AnimatePresence onExitComplete={onClose}>
        {!dismissed && (
          <motion.div
            initial={{ opacity: 0, y: 16, scale: 0.95, filter: "blur(6px)" }}
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
                aria-label={t.dismiss}
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
                <p className="w-full text-sm font-semibold text-white">{t.title}</p>
                <p className="mt-0.5 w-full text-[13px] leading-snug text-white/55">
                  {t.body(update.latest, update.current)}
                </p>
              </div>
            </div>

            {deferInstall ? (
              <p className="w-full text-xs leading-snug text-white/50">
                {t.deferred}
              </p>
            ) : (
              (canAct || status !== "idle") && (
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
