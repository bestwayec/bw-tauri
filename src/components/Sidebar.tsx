import type { ReactNode } from "react";
import type { Route } from "@/App";

type Props = {
  route: Route;
  collapsed: boolean;
  onToggle: () => void;
  onNavigate: (route: Route) => void;
};

type NavId = "dashboard" | "exams" | "history" | "profile" | "settings";

function icon(path: ReactNode) {
  return (
    <svg
      width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"
      className="shrink-0"
    >
      {path}
    </svg>
  );
}

const NAV: Array<{ id: NavId; label: string; hint: string; icon: ReactNode }> = [
  {
    id: "dashboard",
    label: "Dashboard",
    hint: "Overview",
    icon: icon(
      <>
        <rect width="7" height="9" x="3" y="3" rx="1" />
        <rect width="7" height="5" x="14" y="3" rx="1" />
        <rect width="7" height="9" x="14" y="12" rx="1" />
        <rect width="7" height="5" x="3" y="16" rx="1" />
      </>,
    ),
  },
  {
    id: "exams",
    label: "Exams",
    hint: "Assigned tests",
    icon: icon(
      <>
        <path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z" />
        <path d="M14 2v4a2 2 0 0 0 2 2h4" />
        <path d="m9 15 2 2 4-4" />
      </>,
    ),
  },
  {
    id: "history",
    label: "History",
    hint: "Past attempts",
    icon: icon(
      <>
        <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
        <path d="M3 3v5h5" />
        <path d="M12 7v5l4 2" />
      </>,
    ),
  },
  {
    id: "profile",
    label: "Profile",
    hint: "Account",
    icon: icon(
      <>
        <path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2" />
        <circle cx="12" cy="7" r="4" />
      </>,
    ),
  },
  {
    id: "settings",
    label: "Settings",
    hint: "Prefs & connection",
    icon: icon(
      <>
        <circle cx="12" cy="12" r="3" />
        <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
      </>,
    ),
  },
];

/**
 * Collapsible desktop navigation rail: brand, nav items, collapse control.
 * No user card — Profile page is the single account destination.
 */
export default function Sidebar({ route, collapsed, onToggle, onNavigate }: Props) {
  return (
    <aside
      className={`flex h-full shrink-0 flex-col border-r border-border bg-bg-subtle/80 backdrop-blur-xl transition-[width] duration-200 ease-out ${
        collapsed ? "w-[64px]" : "w-60"
      }`}
    >
      {/* Brand */}
      <div className={`flex items-center gap-2.5 px-4 pb-4 pt-5 ${collapsed ? "justify-center px-2" : ""}`}>
        <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-brand to-accent text-base font-black text-brand-fg shadow-[0_0_24px_rgba(137,243,54,0.45)]">
          B
        </div>
        {!collapsed && (
          <div className="min-w-0 leading-tight">
            <p className="truncate text-sm font-bold tracking-tight text-white">Bestway Exam</p>
            <p className="text-[10px] uppercase tracking-[0.18em] text-brand/70">student client</p>
          </div>
        )}
      </div>

      {/* Nav */}
      <nav className="flex-1 space-y-1 overflow-y-auto px-3" aria-label="Main">
        {!collapsed && (
          <p className="px-2 pb-1 pt-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-fg-subtle">
            Menu
          </p>
        )}
        {NAV.map((item) => {
          const active = route === item.id;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => onNavigate(item.id)}
              aria-current={active ? "page" : undefined}
              title={collapsed ? `${item.label} — ${item.hint}` : undefined}
              className={`group flex w-full items-center rounded-xl text-left transition ${
                collapsed ? "justify-center px-2 py-2.5" : "gap-3 px-3 py-2.5"
              } ${
                active
                  ? "bg-brand-subtle text-brand-subtle-fg shadow-[inset_0_0_0_1px_rgba(137,243,54,0.35),0_0_20px_rgba(137,243,54,0.12)]"
                  : "text-fg-muted hover:bg-surface-hover hover:text-fg"
              }`}
            >
              <span className={active ? "text-brand" : "text-fg-subtle group-hover:text-fg-muted"}>
                {item.icon}
              </span>
              {!collapsed && (
                <>
                  <span className="min-w-0 flex-1 leading-tight">
                    <span className="block truncate text-[13px] font-semibold">{item.label}</span>
                    <span className="block truncate text-[11px] text-white/35">{item.hint}</span>
                  </span>
                  {active && <span className="h-5 w-1 shrink-0 rounded-full bg-brand" />}
                </>
              )}
            </button>
          );
        })}
      </nav>

      {/* Collapse control — replaces former user card */}
      <div className="border-t border-border p-3">
        <button
          type="button"
          onClick={onToggle}
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          title={collapsed ? "Expand" : "Collapse"}
          className="grid h-9 w-full place-items-center rounded-xl border border-border bg-surface text-fg-muted transition hover:bg-surface-hover hover:text-fg"
        >
          {collapsed ? (
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="m9 18 6-6-6-6" />
            </svg>
          ) : (
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="m15 18-6-6 6-6" />
            </svg>
          )}
        </button>
      </div>
    </aside>
  );
}
