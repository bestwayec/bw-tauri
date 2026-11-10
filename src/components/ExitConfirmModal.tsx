import { useEffect, useRef } from "react";

type Props = {
  open: boolean;
  onCancel: () => void;
  onConfirm: () => void;
};

function ExitIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="shrink-0 text-white/60">
      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
      <path d="m16 17 5-5-5-5" />
      <path d="M21 12H9" />
    </svg>
  );
}

export default function ExitConfirmModal({ open, onCancel, onConfirm }: Props) {
  const cancelRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const prev = document.activeElement as HTMLElement | null;
    cancelRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onCancel();
      }
    };
    document.addEventListener("keydown", onKey);
    // Prevent background scroll while modal open
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
      prev?.focus?.();
    };
  }, [open, onCancel]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="exit-title"
      aria-describedby="exit-desc"
    >
      {/* Backdrop - subtle, exam remains faintly visible */}
      <div className="absolute inset-0 bg-black/55" aria-hidden="true" />

      {/* Container */}
      <div className="relative w-full max-w-[460px] rounded-2xl border border-white/10 bg-[#111713] p-6 shadow-[0_16px_48px_rgba(0,0,0,0.5)]">
        <div className="flex items-start gap-3">
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-white/[0.06] ring-1 ring-white/10">
            <ExitIcon />
          </span>
          <div className="min-w-0 flex-1">
            <h2 id="exit-title" className="text-[17px] font-bold leading-tight text-white">
              Imtihondan chiqmoqchimisiz?
            </h2>
            <div id="exit-desc" className="mt-2 space-y-1.5 text-sm leading-relaxed text-white/70">
              <p className="font-medium text-emerald-400">Barcha javoblar serverga saqlanadi.</p>
              <p className="text-xs text-white/50">Siz ushbu imtihonni keyinroq Dashboard yoki Imtihonlar bo'limidan davom ettirishingiz mumkin.</p>
            </div>
          </div>
        </div>

        <div className="mt-6 flex items-center justify-end gap-3">
          <button
            ref={cancelRef}
            type="button"
            onClick={onCancel}
            className="btn-ghost rounded-xl px-5 py-2.5 text-sm font-semibold text-white/90 hover:text-white hover:bg-white/10"
          >
            Imtihonda qolish
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className="btn-brand rounded-xl bg-red-600 hover:bg-red-500 text-white px-5 py-2.5 text-sm font-bold shadow-lg shadow-red-600/20 active:scale-95 transition-all"
          >
            Chiqish
          </button>
        </div>
      </div>
    </div>
  );
}
