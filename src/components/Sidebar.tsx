import type { ReactNode } from "react";
import type { Route } from "@/App";

type Props = {
  route: Route;
  collapsed: boolean;
  onToggle: () => void;
  onNavigate: (route: Route) => void;
};

type NavId = "dashboard" | "exams" | "history" | "profile";

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
];

/**
 * Collapsible desktop navigation rail: brand, nav items, collapse control.
 * No user card — Profile page is the single account destination.
 */
export default function Sidebar({ route, collapsed, onToggle, onNavigate }: Props) {
  return (
    <aside
      className={`flex h-full shrink-0 flex-col border-r border-white/10 bg-black/60 backdrop-blur-xl transition-[width] duration-200 ease-out ${
        collapsed ? "w-[64px]" : "w-60"
      }`}
    >
      {/* Brand */}
      <div className={`flex items-center gap-2.5 px-4 pb-4 pt-5 ${collapsed ? "justify-center px-2" : ""}`}>
        <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-emerald-400 to-emerald-600 text-base font-black text-black shadow-[0_0_24px_rgba(56,199,101,0.45)]">
          B
        </div>
        {!collapsed && (
          <div className="min-w-0 leading-tight">
            <p className="truncate text-sm font-bold tracking-tight text-white">Bestway Exam</p>
            <p className="text-[10px] uppercase tracking-[0.18em] text-emerald-300/70">student client</p>
          </div>
        )}
      </div>

      {/* Nav */}
      <nav className="flex-1 space-y-1 overflow-y-auto px-3" aria-label="Main">
        {!collapsed && (
          <p className="px-2 pb-1 pt-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-white/30">
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
                  ? "bg-emerald-400/12 text-emerald-100 shadow-[inset_0_0_0_1px_rgba(56,199,101,0.35),0_0_20px_rgba(56,199,101,0.12)]"
                  : "text-white/55 hover:bg-white/5 hover:text-white"
              }`}
            >
              <span className={active ? "text-emerald-300" : "text-white/40 group-hover:text-white/70"}>
                {item.icon}
              </span>
              {!collapsed && (
                <>
                  <span className="min-w-0 flex-1 leading-tight">
                    <span className="block truncate text-[13px] font-semibold">{item.label}</span>
                    <span className="block truncate text-[11px] text-white/35">{item.hint}</span>
                  </span>
                  {active && <span className="h-5 w-1 shrink-0 rounded-full bg-emerald-400" />}
                </>
              )}
            </button>
          );
        })}
      </nav>

      {/* Collapse control — replaces former user card */}
      <div className="border-t border-white/10 p-3">
        <button
          type="button"
          onClick={onToggle}
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          title={collapsed ? "Expand" : "Collapse"}
          className="grid h-9 w-full place-items-center rounded-xl border border-white/10 bg-white/[0.04] text-white/60 transition hover:bg-white/[0.07] hover:text-white"
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
