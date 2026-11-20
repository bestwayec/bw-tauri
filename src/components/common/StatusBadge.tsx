import type { ReactNode } from "react";

export type BadgeVariant = "brand" | "amber" | "danger" | "info" | "neutral";

interface StatusBadgeProps {
  variant?: BadgeVariant;
  children: ReactNode;
  icon?: ReactNode;
  className?: string;
}

export function StatusBadge({
  variant = "neutral",
  children,
  icon,
  className = "",
}: StatusBadgeProps) {
  const variantClass = {
    brand: "workspace-badge-brand",
    amber: "workspace-badge-amber",
    danger: "workspace-badge-danger",
    info: "workspace-badge-info",
    neutral: "workspace-badge-neutral",
  }[variant];

  return (
    <span className={`workspace-badge ${variantClass} ${className}`}>
      {icon && <span className="shrink-0">{icon}</span>}
      <span>{children}</span>
    </span>
  );
}
