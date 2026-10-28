export type ClientRole = "student" | "teacher" | "instructor" | "admin" | "super_admin";

export const ALLOWED_CLIENT_ROLES: readonly ClientRole[] = [
  "student",
  "teacher",
  "instructor",
  "admin",
  "super_admin",
];

export function normalizeRole(role?: string | null): ClientRole {
  const normalized = (role ?? "").trim().toLowerCase();
  if (
    normalized === "teacher" ||
    normalized === "instructor" ||
    normalized === "admin" ||
    normalized === "super_admin"
  ) {
    return normalized;
  }
  return "student";
}

export function isAllowedClientRole(role?: string | null): boolean {
  const normalized = (role ?? "").trim().toLowerCase();
  return ALLOWED_CLIENT_ROLES.includes(normalized as ClientRole);
}

export function isTeacherRole(role?: string | null): boolean {
  const normalized = normalizeRole(role);
  return normalized === "teacher" || normalized === "instructor";
}

export function isInstructorRole(role?: string | null): boolean {
  return normalizeRole(role) === "instructor";
}

export function isAdminRole(role?: string | null): boolean {
  const normalized = normalizeRole(role);
  return normalized === "admin" || normalized === "super_admin";
}

export function isStaffRole(role?: string | null): boolean {
  return isTeacherRole(role) || isAdminRole(role);
}

export function getClientRoleBadge(role?: string | null): string {
  const normalized = normalizeRole(role);
  if (normalized === "admin" || normalized === "super_admin") {
    return "ADMIN CENTER";
  }
  if (normalized === "instructor") {
    return "INSTRUCTOR CLIENT";
  }
  if (normalized === "teacher") {
    return "TEACHER WORKSPACE";
  }
  return "STUDENT CLIENT";
}
