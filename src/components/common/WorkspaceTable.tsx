import type { ReactNode } from "react";

interface WorkspaceTableProps {
  children: ReactNode;
  className?: string;
  ariaLabel?: string;
}

export function WorkspaceTable({
  children,
  className = "",
  ariaLabel,
}: WorkspaceTableProps) {
  return (
    <div
      className={`w-full overflow-x-auto rounded-xl border border-white/10 ${className}`}
      tabIndex={0}
      role="region"
      aria-label={ariaLabel || "Ma'lumotlar jadvali"}
    >
      <table className="workspace-table">{children}</table>
    </div>
  );
}
