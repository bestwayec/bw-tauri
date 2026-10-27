import type { ReactNode } from "react";
import type { Route } from "@/App";

type Props = {
  route: Route;
  role?: string;
  collapsed: boolean;
  onToggle: () => void;
  onNavigate: (route: Route) => void;
};

export type NavId =
  | "dashboard"
  | "exams"
  | "history"
  | "examTrack"
  | "profile"
  | "settings"
  | "proctoring"
  | "grading"
  | "groups"
  | "centerOverview"
  | "studentResults";

export interface NavItem {
  id: NavId;
  label: string;
  hint: string;
  icon: ReactNode;
}

function icon(path: ReactNode) {
  return (
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
      className="shrink-0"
    >
      {path}
    </svg>
  );
}

// Student navigation (default)
const STUDENT_NAV: NavItem[] = [
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
      </>
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
      </>
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
      </>
    ),
  },
  {
    id: "examTrack",
    label: "Exam Track",
    hint: "IELTS / Multilevel",
    icon: icon(
      <>
        <path d="M4 7h16M16 3l4 4-4 4M20 17H4M8 13l-4 4 4 4" />
      </>
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
      </>
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
      </>
    ),
  },
];

// Teacher navigation
const TEACHER_NAV: NavItem[] = [
  {
    id: "proctoring",
    label: "Live Proctoring",
    hint: "Active exams & surveillance",
    icon: icon(
      <>
        <path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z" />
        <circle cx="12" cy="12" r="3" />
      </>
    ),
  },
  {
    id: "grading",
    label: "Grading Queue",
    hint: "Speaking & writing scoring",
    icon: icon(
      <>
        <path d="m9 12 2 2 4-4" />
        <path d="M5 7c0-1.1.9-2 2-2h10a2 2 0 0 1 2 2v12H5V7Z" />
        <path d="M9 3h6" />
      </>
    ),
  },
  {
    id: "groups",
    label: "Groups & Results",
    hint: "Cohorts & class progress",
    icon: icon(
      <>
        <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
        <circle cx="9" cy="7" r="4" />
        <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
        <path d="M16 3.13a4 4 0 0 1 0 7.75" />
      </>
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
      </>
    ),
  },
  {
    id: "settings",
    label: "Settings",
    hint: "Prefs & audio setup",
    icon: icon(
      <>
        <circle cx="12" cy="12" r="3" />
        <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
      </>
    ),
  },
];

// Admin navigation
const ADMIN_NAV: NavItem[] = [
  {
    id: "centerOverview",
    label: "Center Overview",
    hint: "HQ labs & stations telemetry",
    icon: icon(
      <>
        <rect width="18" height="18" x="3" y="3" rx="2" />
        <path d="M3 9h18" />
        <path d="M9 21V9" />
      </>
    ),
  },
  {
    id: "proctoring",
    label: "Live Proctoring",
    hint: "Live anti-cheat surveillance",
    icon: icon(
      <>
        <path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z" />
        <circle cx="12" cy="12" r="3" />
      </>
    ),
  },
  {
    id: "studentResults",
    label: "Student Results",
    hint: "Scores registry & certificates",
    icon: icon(
      <>
        <path d="M12 2v20" />
        <path d="m17 5-5-3-5 3v6c0 5 3.5 8 5 9 1.5-1 5-4 5-9V5Z" />
      </>
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
      </>
    ),
  },
  {
    id: "settings",
    label: "Settings",
    hint: "Security & center config",
    icon: icon(
      <>
        <circle cx="12" cy="12" r="3" />
        <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
      </>
    ),
  },
];

export function getNavItemsForRole(role?: string): NavItem[] {
  const norm = (role ?? "student").toLowerCase();
  if (norm === "teacher") return TEACHER_NAV;
  if (norm === "admin" || norm === "super_admin") return ADMIN_NAV;
  return STUDENT_NAV;
}

function WingedEmblem({ className = "h-10 w-10" }: { className?: string }) {
  return (
    <svg viewBox="0 0 48 48" role="img" aria-label="BestWay" className={`shrink-0 select-none ${className}`} xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="bw_sb_grad" x1="4" y1="2" x2="44" y2="46" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#34D399" />
          <stop offset="55%" stopColor="#10B981" />
          <stop offset="100%" stopColor="#059669" />
        </linearGradient>
        <linearGradient id="bw_sb_wing" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#FFFFFF" stopOpacity="0.95" />
          <stop offset="100%" stopColor="#E2E8F0" stopOpacity="0.85" />
        </linearGradient>
        <radialGradient id="bw_sb_sun" cx="50%" cy="35%" r="65%">
          <stop offset="0%" stopColor="#FFFFFF" />
          <stop offset="45%" stopColor="#FEF08A" />
          <stop offset="100%" stopColor="#F59E0B" />
        </radialGradient>
      </defs>
      <rect x="1.5" y="1.5" width="45" height="45" rx="12" fill="url(#bw_sb_grad)" />
      <path d="M13.5 2H34.5C41.4 2 46 6.6 46 13.5V17C46 10.1 40.5 5 34.5 5H13.5C7.5 5 2 10.1 2 17V13.5C2 6.6 6.6 2 13.5 2Z" fill="#FFFFFF" opacity="0.25" />
      <circle cx="24" cy="14" r="5.5" fill="url(#bw_sb_sun)" />
      <g stroke="#FEF08A" strokeWidth="1.6" strokeLinecap="round" opacity="0.9">
        <line x1="24" y1="5" x2="24" y2="7" />
        <line x1="15.5" y1="7.5" x2="17" y2="9" />
        <line x1="32.5" y1="7.5" x2="31" y2="9" />
      </g>
      <path fill="url(#bw_sb_wing)" d="M5 21.5C12.5 26.5 18.5 29.5 24 29.8C29.5 29.5 35.5 26.5 43 21.5C40.5 24.2 37.8 26.2 34.8 27.7C30.8 29.8 27.2 31.1 24 32.4C20.8 31.1 17.2 29.8 13.2 27.7C10.2 26.2 7.5 24.2 5 21.5Z" opacity="0.96" />
      <path fill="#FFFFFF" fillRule="evenodd" d="M18.5 12H26C29.6 12 32 14.2 32 17.3C32 19.3 30.9 20.8 29.2 21.6C31.5 22.3 33 24.2 33 26.9C33 30.3 30.4 32.6 26.4 32.6H18.5V12ZM22.5 15.5V19.8H25.6C27 19.8 27.7 19 27.7 17.7C27.7 16.4 27 15.5 25.6 15.5H22.5ZM22.5 23.2V29H25.9C27.4 29 28.3 27.9 28.3 26.1C28.3 24.4 27.4 23.2 25.9 23.2H22.5Z" />
    </svg>
  );
}

/**
 * Collapsible modern desktop navigation rail: brand, role-aware nav items, collapse control.
 */
export default function Sidebar({ route, role, collapsed, onToggle, onNavigate }: Props) {
  const navItems = getNavItemsForRole(role);
  const normRole = (role ?? "student").toLowerCase();
  const isTeacher = normRole === "teacher";
  const isAdmin = normRole === "admin" || normRole === "super_admin";

  const roleBadge = isTeacher
    ? "TEACHER WORKSPACE"
    : isAdmin
    ? "ADMIN CENTER"
    : "STUDENT CLIENT";

  return (
    <aside
      className={`hidden h-full shrink-0 flex-col border-r border-white/8 bg-[#0B0F17]/90 backdrop-blur-2xl transition-[width] duration-200 ease-out lg:flex ${
        collapsed ? "w-[68px]" : "w-64"
      }`}
    >
      {/* Brand Header */}
      <div className={`flex items-center gap-3 px-4 pb-4 pt-5 ${collapsed ? "justify-center px-2" : ""}`}>
        <WingedEmblem className="h-10 w-10 drop-shadow-[0_0_20px_rgba(16,185,129,0.5)]" />
        {!collapsed && (
          <div className="min-w-0 leading-tight">
            <p className="truncate text-sm font-bold tracking-tight text-white">Bestway Exam</p>
            <p
              className={`text-[9px] font-bold uppercase tracking-[0.18em] ${
                isTeacher || isAdmin ? "text-emerald-400" : "text-emerald-400/70"
              }`}
            >
              {roleBadge}
            </p>
          </div>
        )}
      </div>

      {/* Nav */}
      <nav className="flex-1 space-y-1.5 overflow-y-auto px-3 pt-2" aria-label="Main">
        {!collapsed && (
          <p className="px-2 pb-1.5 text-[10px] font-semibold uppercase tracking-[0.18em] text-white/40">
            Navigation
          </p>
        )}
        {navItems.map((item) => {
          const active = route === item.id;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => onNavigate(item.id as Route)}
              aria-current={active ? "page" : undefined}
              title={collapsed ? `${item.label} — ${item.hint}` : undefined}
              className={`group flex w-full items-center rounded-xl text-left transition duration-150 ${
                collapsed ? "justify-center px-2 py-2.5" : "gap-3 px-3 py-2.5"
              } ${
                active
                  ? "border border-emerald-500/25 bg-emerald-500/10 text-emerald-300 shadow-[0_0_20px_rgba(16,185,129,0.12)]"
                  : "text-white/60 hover:bg-white/[0.04] hover:text-white"
              }`}
            >
              <span className={active ? "text-emerald-400" : "text-white/45 group-hover:text-white/75"}>
                {item.icon}
              </span>
              {!collapsed && (
                <>
                  <span className="min-w-0 flex-1 leading-tight">
                    <span className="block truncate text-[13px] font-semibold">{item.label}</span>
                    <span className="block truncate text-[11px] text-white/35">{item.hint}</span>
                  </span>
                  {active && <span className="h-5 w-1 shrink-0 rounded-full bg-emerald-400 shadow-[0_0_8px_#10B981]" />}
                </>
              )}
            </button>
          );
        })}
      </nav>

      {/* Collapse control */}
      <div className="border-t border-white/8 p-3">
        <button
          type="button"
          onClick={onToggle}
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          title={collapsed ? "Expand" : "Collapse"}
          className="grid h-9 w-full place-items-center rounded-xl border border-white/8 bg-surface/60 text-white/50 transition hover:bg-surface-hover hover:text-white"
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

/** Mobile navigation supporting multi-role */
export function MobileNavigation({
  route,
  role,
  onNavigate,
}: Pick<Props, "route" | "role" | "onNavigate">) {
  const navItems = getNavItemsForRole(role);
  return (
    <nav
      aria-label="Mobile main"
      className="grid shrink-0 grid-cols-3 gap-1 border-b border-white/8 bg-[#0B0F17]/90 p-2 lg:hidden"
    >
      {navItems.map((item) => (
        <button
          key={item.id}
          type="button"
          onClick={() => onNavigate(item.id as Route)}
          aria-current={route === item.id ? "page" : undefined}
          className={`flex items-center justify-center gap-1.5 rounded-lg px-2 py-2 text-xs transition ${
            route === item.id
              ? "bg-emerald-500/20 text-emerald-300 font-semibold"
              : "text-white/60 hover:bg-white/5"
          }`}
        >
          {item.icon}
          <span className="truncate">{item.label}</span>
        </button>
      ))}
    </nav>
  );
}
