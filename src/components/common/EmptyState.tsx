import type { ReactNode } from "react";

interface EmptyStateProps {
  icon?: ReactNode;
  title: string;
  description?: string;
  action?: {
    label: string;
    onClick: () => void;
  };
  className?: string;
}

export function EmptyState({
  icon,
  title,
  description,
  action,
  className = "",
}: EmptyStateProps) {
  return (
    <div
      role="status"
      className={`workspace-panel flex flex-col items-center justify-center p-8 text-center space-y-3 ${className}`}
    >
      {icon && (
        <div
          className="grid h-12 w-12 place-items-center rounded-2xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-xl"
          aria-hidden="true"
        >
          {icon}
        </div>
      )}
      <div className="space-y-1">
        <h3 className="text-base font-bold text-white">{title}</h3>
        {description && (
          <p className="max-w-md text-xs text-slate-400 leading-relaxed">
            {description}
          </p>
        )}
      </div>
      {action && (
        <button
          type="button"
          onClick={action.onClick}
          className="btn-brand mt-2 rounded-xl px-4 py-2 text-xs font-bold text-slate-950 shadow-md hover:scale-[1.02] transition-transform"
        >
          {action.label}
        </button>
      )}
    </div>
  );
}
