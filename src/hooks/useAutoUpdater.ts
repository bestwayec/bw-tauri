import { useEffect, useRef, useState } from "react";
import { getDismissedVersion, dismissVersion, type UpdateInfo } from "@/lib/version";

export type UpdaterStatus = "idle" | "checking" | "available" | "downloading" | "installing" | "error";

export interface AutoUpdaterState {
  status: UpdaterStatus;
  updateInfo: UpdateInfo | null;
  progress: number | null;
  error: string | null;
  checkForUpdates: () => Promise<void>;
  installAndRelaunch: () => Promise<void>;
  dismiss: () => void;
}

export function useAutoUpdater(autoCheck: boolean = true): AutoUpdaterState {
  const [status, setStatus] = useState<UpdaterStatus>("idle");
  const [updateInfo, setUpdateInfo] = useState<UpdateInfo | null>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Cached update object reference from @tauri-apps/plugin-updater
  const tauriUpdateRef = useRef<any>(null);
  const hasCheckedRef = useRef(false);

  const checkForUpdates = async () => {
    try {
      setStatus("checking");
      setError(null);

      // 1. Primary: Signed in-place updater via Tauri plugin
      const updater = await import("@tauri-apps/plugin-updater");
      const found = await updater.check();

      if (found && found.available) {
        tauriUpdateRef.current = found;
        const info: UpdateInfo = {
          current: found.currentVersion,
          latest: found.version,
          downloadUrl: null,
          body: found.body || null,
          date: found.date || null,
        };

        if (getDismissedVersion() !== info.latest) {
          setUpdateInfo(info);
          setStatus("available");
          return;
        }
      }

      setStatus("idle");
    } catch (err: unknown) {
      console.warn("[auto-updater] In-place updater check failed:", err);
      setStatus("idle");
    }
  };

  const installAndRelaunch = async () => {
    if (!tauriUpdateRef.current) {
      setError("No active update instance found.");
      return;
    }

    try {
      setError(null);
      setStatus("downloading");
      setProgress(0);

      let total = 0;
      let downloaded = 0;

      await tauriUpdateRef.current.downloadAndInstall((event: any) => {
        if (event.event === "Started") {
          total = event.data?.contentLength ?? 0;
          setProgress(0);
        } else if (event.event === "Progress") {
          const chunk = event.data?.chunkLength ?? 0;
          downloaded += chunk;
          if (total > 0) {
            setProgress(Math.min(99, Math.round((downloaded / total) * 100)));
          } else {
            setProgress((p) => Math.min(99, (p ?? 0) + 1));
          }
        } else if (event.event === "Finished") {
          setProgress(100);
        }
      });

      setStatus("installing");
      const proc = await import("@tauri-apps/plugin-process");
      await proc.relaunch();
    } catch (err: any) {
      console.error("[auto-updater] Failed to download or install update:", err);
      setError(err?.message || "Failed to install update.");
      setStatus("error");
    }
  };

  const dismiss = () => {
    if (updateInfo) {
      dismissVersion(updateInfo.latest);
    }
    setUpdateInfo(null);
    setStatus("idle");
  };

  useEffect(() => {
    if (!autoCheck || hasCheckedRef.current) return;
    hasCheckedRef.current = true;

    // Silent background check on app boot after 2 seconds
    const timer = setTimeout(() => {
      void checkForUpdates();
    }, 2000);

    return () => clearTimeout(timer);
  }, [autoCheck]);

  return {
    status,
    updateInfo,
    progress,
    error,
    checkForUpdates,
    installAndRelaunch,
    dismiss,
  };
}
