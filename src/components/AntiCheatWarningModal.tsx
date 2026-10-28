
export interface AntiCheatWarningModalProps {
  isOpen: boolean;
  strikesCount: number;
  maxStrikes?: number;
  countdown: number;
  isTerminated?: boolean;
  onDismiss: () => void;
}

export default function AntiCheatWarningModal({
  isOpen,
  strikesCount,
  maxStrikes = 3,
  countdown,
  isTerminated = false,
  onDismiss,
}: AntiCheatWarningModalProps) {
  if (!isOpen && !isTerminated) return null;

  const isCritical = strikesCount >= 2;
  const isFinal = strikesCount >= maxStrikes || isTerminated;

  return (
    <div
      className="fixed inset-0 z-[99999] flex items-center justify-center bg-black/90 p-4 backdrop-blur-md transition-all animate-fadeIn"
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="anti-cheat-title"
    >
      <div className="w-full max-w-lg rounded-3xl border border-red-500/40 bg-[#0B0F17] p-8 shadow-2xl text-center text-white relative overflow-hidden">
        {/* Glow ambient background */}
        <div
          className={`absolute -top-24 -left-24 w-48 h-48 rounded-full blur-3xl pointer-events-none ${
            isFinal ? "bg-red-600/30" : isCritical ? "bg-amber-600/25" : "bg-red-500/20"
          }`}
        />
        <div
          className={`absolute -bottom-24 -right-24 w-48 h-48 rounded-full blur-3xl pointer-events-none ${
            isFinal ? "bg-red-600/30" : "bg-emerald-500/20"
          }`}
        />

        {/* Header Icon */}
        <div className="relative mx-auto mb-6 flex h-20 w-20 items-center justify-center rounded-3xl bg-red-500/15 border border-red-500/30 text-red-400 shadow-lg">
          {isFinal ? (
            <svg className="w-10 h-10 text-red-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <circle cx="12" cy="12" r="10" />
              <line x1="15" y1="9" x2="9" y2="15" />
              <line x1="9" y1="9" x2="15" y2="15" />
            </svg>
          ) : (
            <svg className="w-10 h-10 text-amber-400 animate-pulse" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <path d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
          )}
        </div>

        {/* Title */}
        <h3 id="anti-cheat-title" className="text-2xl font-bold tracking-tight text-white mb-2">
          {isFinal
            ? "Imtihon Majburiy To'xtatildi (Disqualified)"
            : "Diqqat! Imtihon Maydonidan Chiqish Taqiqlanadi"}
        </h3>

        {/* Description */}
        <p className="text-sm text-gray-300 leading-relaxed mb-6">
          {isFinal
            ? "Qoidabuzarliklar soni 3 taga yetgani yoki nazoratchi buyrug'i sababli imtihon bekor qilindi. Barcha yozuvlar va hodisalar proktor jurnaliga muhrlandi."
            : "Imtihon paytida oynani kichraytirish, boshqa ilovalarga o'tish yoki klaviatura xavfsizlik qoidalarini buzish qat'iyan man etiladi."}
        </p>

        {/* Strikes Indicator Bar */}
        <div className="mb-6 rounded-2xl bg-[#111827] border border-gray-800 p-4">
          <div className="flex items-center justify-between mb-3">
            <span className="text-xs uppercase tracking-wider font-semibold text-gray-400">
              Qoidabuzarliklar holati (Strikes)
            </span>
            <span
              className={`text-sm font-bold ${
                isFinal ? "text-red-400" : isCritical ? "text-amber-400" : "text-yellow-400"
              }`}
            >
              {Math.min(strikesCount, maxStrikes)} / {maxStrikes}
            </span>
          </div>

          <div className="grid grid-cols-3 gap-2">
            {[1, 2, 3].map((step) => {
              const active = strikesCount >= step;
              return (
                <div
                  key={step}
                  className={`h-2.5 rounded-full transition-all duration-300 ${
                    active
                      ? step === 3
                        ? "bg-red-500 shadow-[0_0_12px_rgba(239,68,68,0.7)]"
                        : step === 2
                        ? "bg-amber-500 shadow-[0_0_10px_rgba(245,158,11,0.5)]"
                        : "bg-yellow-400"
                      : "bg-gray-800"
                  }`}
                />
              );
            })}
          </div>

          {!isFinal && (
            <p className="mt-3 text-xs text-amber-300/90 text-left">
              ⚠️ 3-marta qoidabuzarlikda imtihon avtomatik tarzda majburiy yakunlanadi!
            </p>
          )}
        </div>

        {/* Action Button & Countdown */}
        {!isFinal ? (
          <button
            type="button"
            className="w-full relative group rounded-2xl bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white font-bold py-3.5 px-6 shadow-xl shadow-emerald-950/40 transition-all cursor-pointer flex items-center justify-center gap-3 active:scale-[0.98]"
            onClick={onDismiss}
          >
            <span>Imtihonga qaytish</span>
            <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-white/20 text-xs font-mono">
              {countdown}s
            </span>
          </button>
        ) : (
          <div className="p-3 rounded-xl bg-red-950/40 border border-red-500/30 text-xs text-red-300 font-mono">
            STATUS: PROCTOR_TERMINATED (Natija saqlandi)
          </div>
        )}
      </div>
    </div>
  );
}
