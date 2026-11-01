import { AnimatePresence, motion } from "motion/react";
import type { AutoUpdaterState } from "@/hooks/useAutoUpdater";

interface Props {
  updater: AutoUpdaterState;
  /** True while an exam is currently running to prevent premature restarts */
  examActive?: boolean;
}

export default function UpdateModal({ updater, examActive = false }: Props) {
  const { status, updateInfo, progress, error, installAndRelaunch, dismiss } = updater;

  const isVisible = (status === "available" || status === "downloading" || status === "installing" || status === "error") && updateInfo != null;
  const isBusy = status === "downloading" || status === "installing";

  if (!isVisible) return null;

  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
        {/* Backdrop */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={isBusy ? undefined : dismiss}
          className="absolute inset-0 bg-black/80 backdrop-blur-md"
        />

        {/* Modal Window */}
        <motion.div
          role="dialog"
          aria-modal="true"
          aria-labelledby="update-modal-title"
          initial={{ opacity: 0, scale: 0.92, y: 16 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.92, y: 16 }}
          transition={{ duration: 0.25, ease: "easeOut" }}
          className="relative z-10 w-full max-w-md overflow-hidden rounded-2xl border border-emerald-500/30 bg-[#0B0F17] p-6 shadow-[0_24px_70px_rgba(0,0,0,0.85)]"
        >
          {/* Header Icon + Version Badge */}
          <div className="flex items-start justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-emerald-500/10 text-emerald-400 ring-1 ring-emerald-500/25">
                <svg
                  width="24"
                  height="24"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                  <polyline points="7 10 12 15 17 10" />
                  <line x1="12" y1="15" x2="12" y2="3" />
                </svg>
              </div>
              <div>
                <h3 id="update-modal-title" className="text-lg font-bold text-white">
                  Yangi versiya mavjud!
                </h3>
                <div className="mt-1 flex items-center gap-2">
                  <span className="rounded-md bg-white/10 px-2 py-0.5 text-xs font-medium text-white/70">
                    Hozirgi: v{updateInfo.current}
                  </span>
                  <span className="text-xs text-white/40">➔</span>
                  <span className="rounded-md bg-emerald-500/20 px-2 py-0.5 text-xs font-semibold text-emerald-400">
                    Yangi: v{updateInfo.latest}
                  </span>
                </div>
              </div>
            </div>

            {!isBusy && (
              <button
                type="button"
                onClick={dismiss}
                aria-label="Yopish"
                className="rounded-lg p-1.5 text-white/40 transition hover:bg-white/10 hover:text-white"
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            )}
          </div>

          {/* Release Notes */}
          <div className="mt-4 rounded-xl border border-white/5 bg-white/[0.03] p-3 text-left">
            <p className="text-xs font-semibold uppercase tracking-wider text-white/50">
              O&apos;zgarishlar va yangiliklar:
            </p>
            <p className="mt-1 text-sm leading-relaxed text-white/80">
              {updateInfo.body ||
                "Dasturning tezkorligi va xavfsizligi oshirildi, oflayn darslarni shifrlash va yangi tizim optimizatsiyalari qo'shildi."}
            </p>
          </div>

          {/* Active Exam Safety Warning */}
          {examActive && (
            <div className="mt-4 flex items-center gap-2.5 rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-200">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
                <line x1="12" y1="9" x2="12" y2="13" />
                <line x1="12" y1="17" x2="12.01" y2="17" />
              </svg>
              <span>Hozirda imtihon jarayoni davom etmoqda. Yangilanish imtihon tugagandan so&apos;ng o&apos;rnatiladi.</span>
            </div>
          )}

          {/* Progress Bar */}
          {status === "downloading" && progress != null && (
            <div className="mt-4 space-y-1.5">
              <div className="flex justify-between text-xs text-white/70">
                <span>Yuklab olinmoqda...</span>
                <span className="font-semibold text-emerald-400">{progress}%</span>
              </div>
              <div className="h-2 w-full overflow-hidden rounded-full bg-white/10">
                <motion.div
                  className="h-full bg-emerald-500"
                  initial={{ width: 0 }}
                  animate={{ width: `${progress}%` }}
                  transition={{ duration: 0.15 }}
                />
              </div>
            </div>
          )}

          {/* Installing State */}
          {status === "installing" && (
            <div className="mt-4 flex items-center justify-center gap-2 text-sm text-emerald-400">
              <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path
                  className="opacity-75"
                  fill="currentColor"
                  d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                />
              </svg>
              <span>O&apos;rnatilmoqda va qayta ishga tushirilmoqda...</span>
            </div>
          )}

          {/* Error Message */}
          {error && (
            <p role="alert" className="mt-3 text-center text-xs text-rose-400">
              {error}
            </p>
          )}

          {/* Action Buttons */}
          <div className="mt-6 flex items-center justify-end gap-3">
            {!isBusy && (
              <button
                type="button"
                onClick={dismiss}
                className="rounded-xl px-4 py-2 text-xs font-semibold text-white/60 transition hover:bg-white/5 hover:text-white"
              >
                Keyinroq
              </button>
            )}

            {!examActive && (
              <button
                type="button"
                onClick={() => void installAndRelaunch()}
                disabled={isBusy}
                className="flex items-center gap-2 rounded-xl bg-emerald-500 px-5 py-2.5 text-xs font-bold text-black shadow-lg shadow-emerald-500/20 transition hover:bg-emerald-400 active:scale-95 disabled:opacity-60"
              >
                {status === "downloading" ? (
                  `Yuklanmoqda (${progress ?? 0}%)`
                ) : status === "installing" ? (
                  "O'rnatilmoqda..."
                ) : (
                  <>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                      <polyline points="7 10 12 15 17 10" />
                      <line x1="12" y1="15" x2="12" y2="3" />
                    </svg>
                    <span>Yangilash va qayta yuklash</span>
                  </>
                )}
              </button>
            )}
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  );
}
