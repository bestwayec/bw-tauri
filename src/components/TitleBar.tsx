import { useEffect, useState } from "react";

export interface TitleBarProps {
  examActive?: boolean;
}

export default function TitleBar({ examActive = false }: TitleBarProps) {
  const [online, setOnline] = useState(() => (typeof navigator === "undefined" ? true : navigator.onLine));
  const [isMaximized, setIsMaximized] = useState(false);

  useEffect(() => {
    const up = () => setOnline(true);
    const down = () => setOnline(false);
    window.addEventListener("online", up);
    window.addEventListener("offline", down);
    return () => {
      window.removeEventListener("online", up);
      window.removeEventListener("offline", down);
    };
  }, []);

  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const { getCurrentWindow } = await import("@tauri-apps/api/window");
        const appWindow = getCurrentWindow();
        const max = await appWindow.isMaximized();
        if (alive) setIsMaximized(max);
      } catch {
        /* outside Tauri environment (e.g. browser or tests) */
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  const handleMinimize = async () => {
    try {
      const { getCurrentWindow } = await import("@tauri-apps/api/window");
      await getCurrentWindow().minimize();
    } catch {
      /* fallback */
    }
  };

  const handleMaximize = async () => {
    try {
      const { getCurrentWindow } = await import("@tauri-apps/api/window");
      const appWindow = getCurrentWindow();
      await appWindow.toggleMaximize();
      const max = await appWindow.isMaximized();
      setIsMaximized(max);
    } catch {
      /* fallback */
    }
  };

  const handleClose = async () => {
    if (examActive) {
      return;
    }
    try {
      const { getCurrentWindow } = await import("@tauri-apps/api/window");
      await getCurrentWindow().close();
    } catch {
      /* fallback */
    }
  };

  return (
    <header
      data-tauri-drag-region
      className="select-none flex h-9 w-full items-center justify-between px-3 bg-[#0B0F17]/90 backdrop-blur-md border-b border-white/5 text-white/80 z-50 text-xs shrink-0"
    >
      <div className="flex items-center gap-2.5 pointer-events-none">
        <svg
          className="w-4 h-4 text-emerald-400"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M12 2L2 7l10 5 10-5-10-5z" />
          <path d="M2 17l10 5 10-5" />
          <path d="M2 12l10 5 10-5" />
        </svg>
        <span className="font-semibold tracking-wide text-white/90">BestWay Exam</span>
        <span className="text-[10px] px-1.5 py-0.5 rounded bg-white/10 text-white/60 font-mono">v0.8.3</span>
        {examActive && (
          <span className="flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-emerald-500/15 border border-emerald-500/30 text-emerald-400 text-[10px] font-medium tracking-wide">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
            Exam Mode — Fullscreen Protected
          </span>
        )}
      </div>

      <div data-tauri-drag-region className="flex-1 h-full cursor-default" />

      <div className="flex items-center gap-3">
        <div
          className="flex items-center gap-1.5 text-[11px] text-white/50"
          title={online ? "Online" : "Offline"}
        >
          <span
            className={`h-2 w-2 rounded-full transition-colors ${
              online ? "bg-emerald-400 shadow-[0_0_8px_#34d399]" : "bg-amber-400 shadow-[0_0_8px_#fbbf24]"
            }`}
          />
          <span className="hidden sm:inline text-[10px] font-medium uppercase tracking-wider text-white/60">
            {online ? "Online" : "Offline"}
          </span>
        </div>

        <div className="flex items-center -mr-1">
          <button
            type="button"
            onClick={handleMinimize}
            className="flex h-7 w-8 items-center justify-center rounded hover:bg-white/10 active:bg-white/15 text-white/70 hover:text-white transition-colors"
            title="Minimize"
            aria-label="Minimize"
          >
            <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M5 12h14" />
            </svg>
          </button>
          <button
            type="button"
            onClick={handleMaximize}
            className="flex h-7 w-8 items-center justify-center rounded hover:bg-white/10 active:bg-white/15 text-white/70 hover:text-white transition-colors"
            title={isMaximized ? "Restore" : "Maximize"}
            aria-label={isMaximized ? "Restore" : "Maximize"}
          >
            {isMaximized ? (
              <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <rect x="5" y="7" width="12" height="12" rx="1" />
                <path d="M7 5h12v12" />
              </svg>
            ) : (
              <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <rect x="4" y="4" width="16" height="16" rx="1.5" />
              </svg>
            )}
          </button>
          <button
            type="button"
            onClick={handleClose}
            disabled={examActive}
            className={`flex h-7 w-8 items-center justify-center rounded transition-colors ${
              examActive
                ? "opacity-30 cursor-not-allowed text-white/40"
                : "hover:bg-red-500/80 active:bg-red-600 text-white/70 hover:text-white"
            }`}
            title={examActive ? "Imtihon rejimida yopish taqiqlangan" : "Close"}
            aria-label="Close"
          >
            <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M6 6l12 12M6 18L18 6" />
            </svg>
          </button>
        </div>
      </div>
    </header>
  );
}
