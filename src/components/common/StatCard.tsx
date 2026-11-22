import type { ReactNode } from "react";

interface StatCardProps {
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  icon?: ReactNode;
  accent?: boolean;
  isLoading?: boolean;
  isError?: boolean;
  onRetry?: () => void;
  retryLabel?: string;
  className?: string;
}

export function StatCard({
  label,
  value,
  sub,
  icon,
  accent = false,
  isLoading = false,
  isError = false,
  onRetry,
  retryLabel = "Yuklab bo‘lmadi · Qayta urinish ⟳",
  className = "",
}: StatCardProps) {
  return (
    <div
      className={`workspace-panel flex items-center justify-between p-5 shadow-sm transition-all hover:border-emerald-500/30 ${className}`}
    >
      <div className="min-w-0 pr-2">
        <p className="text-[11px] font-bold uppercase tracking-wider text-slate-400 truncate">
          {label}
        </p>
        <p
          className={`mt-1 text-2xl font-black tabular-nums truncate ${
            accent ? "text-emerald-400" : isError ? "text-red-400" : "text-white"
          }`}
        >
          {isLoading ? "…" : isError ? "—" : value}
        </p>
        {isError && onRetry ? (
          <button
            type="button"
            onClick={onRetry}
            className="mt-0.5 text-[10px] text-red-300 underline font-semibold hover:text-red-200 transition-colors"
          >
            {retryLabel}
          </button>
        ) : sub ? (
          <p className="mt-0.5 text-[11px] text-slate-400 truncate">{sub}</p>
        ) : null}
      </div>

      {icon && (
        <span
          className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-lg"
          aria-hidden="true"
        >
          {icon}
        </span>
      )}
    </div>
  );
}
