/**
 * Thin wrappers over the Rust-owned session commands (see
 * src-tauri/src/session.rs). Outside Tauri (plain `vite dev` in a browser)
 * the getters return null and the setters no-op, and session-store.ts falls
 * back to the encrypted-localStorage session. Inside Tauri, IPC failures
 * THROW (a silent fallback there would split tokens across two stores).
 */

export interface RustSessionData {
  access_token: string | null;
  refresh_token: string | null;
  device_id: string | null;
  profile_json: string | null;
}

export function isTauriRuntime(): boolean {
  try {
    return (
      typeof window !== "undefined" &&
      ("__TAURI_INTERNALS__" in window || "__TAURI__" in window)
    );
  } catch {
    return false;
  }
}

async function invokeRaw<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  const mod = await import("@tauri-apps/api/core").catch(() => null);
  const fn = (mod as { invoke?: unknown } | null)?.invoke;
  if (typeof fn !== "function") throw new Error("NOT_TAURI_RUNTIME");
  return (fn as (c: string, a?: Record<string, unknown>) => Promise<T>)(cmd, args);
}

/** Null outside Tauri; the stored session (possibly empty) inside. */
export async function rustSessionGet(): Promise<RustSessionData | null> {
  if (!isTauriRuntime()) return null;
  return invokeRaw<RustSessionData>("session_get");
}

export async function rustSessionSet(data: RustSessionData): Promise<void> {
  if (!isTauriRuntime()) return;
  await invokeRaw<null>("session_set", { data });
}

export async function rustSessionClear(): Promise<void> {
  if (!isTauriRuntime()) return;
  await invokeRaw<null>("session_clear");
}

/** Returns the fresh access token; throws the backend verdict string. */
export async function rustAuthRefresh(baseUrl: string, expectedAccess: string | null): Promise<string> {
  return invokeRaw<string>("auth_refresh", { baseUrl, expectedAccess });
}

export async function rustAuthLogout(baseUrl: string): Promise<void> {
  if (!isTauriRuntime()) return;
  await invokeRaw<null>("auth_logout", { baseUrl });
}
