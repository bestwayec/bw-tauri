/**
 * Hard-coded sample content (demo students, a sample live room) may appear only in a dev build (`vite`) or in
 * a build made on purpose with VITE_DEMO_DATA=true. A production build and a real session never show it.
 */
export function demoDataEnabled(env: { DEV?: boolean; VITE_DEMO_DATA?: string } | undefined = import.meta.env): boolean {
  return env?.DEV === true || env?.VITE_DEMO_DATA === "true";
}
