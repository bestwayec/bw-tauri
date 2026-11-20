import { useCallback, useEffect, useState } from "react";
import type { Route } from "@/App";
import { useSessionStore } from "@/lib/session-store";
import {
  getUserOfflineVocabularyOverview,
  syncAllUserOfflineVocabulary,
  type OfflineVocabularyOverview,
} from "@/lib/offline-vocabulary";

interface Props {
  onNavigate: (route: Route) => void;
  userId?: string;
}

export function StudentOfflineVocabWidget({ onNavigate, userId }: Props) {
  const sessionUserId = useSessionStore((state) => state.profile?.id);
  const activeUserId = userId || sessionUserId || "anonymous";

  const [isOnline, setIsOnline] = useState(
    typeof navigator !== "undefined" ? navigator.onLine : true,
  );
  const [overview, setOverview] = useState<OfflineVocabularyOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [isSyncing, setIsSyncing] = useState(false);
  const [syncError, setSyncError] = useState<string | null>(null);

  const loadOverview = useCallback(async () => {
    try {
      const data = await getUserOfflineVocabularyOverview(activeUserId);
      setOverview(data);
    } catch {
      // offline fallback
    } finally {
      setLoading(false);
    }
  }, [activeUserId]);

  useEffect(() => {
    loadOverview();
  }, [loadOverview]);

  useEffect(() => {
    const handleOnline = () => {
      setIsOnline(true);
      loadOverview();
    };
    const handleOffline = () => setIsOnline(false);

    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);
    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, [loadOverview]);

  const handleManualSync = async () => {
    if (!isOnline || isSyncing) return;
    setIsSyncing(true);
    setSyncError(null);
    try {
      const res = await syncAllUserOfflineVocabulary(activeUserId);
      if (!res.success && res.errors.length) {
        setSyncError(res.errors[0]);
      }
      await loadOverview();
    } catch (err) {
      setSyncError(err instanceof Error ? err.message : "Sinxronlashda xatolik yuz berdi");
    } finally {
      setIsSyncing(false);
    }
  };

  return (
    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 rounded-2xl border border-emerald-500/20 bg-[#111827] p-4 shadow-sm">
      <div className="flex items-start sm:items-center gap-3">
        <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-purple-500/10 border border-purple-500/20 text-purple-400 mt-0.5 sm:mt-0">
          <svg className="size-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M4 19V5a2 2 0 0 1 2-2h14v18H6a2 2 0 0 1 0-4h14" />
            <path d="M8 7h8M8 11h6" />
          </svg>
        </div>

        <div className="space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Offline Study</span>
            <span
              className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold ${
                isOnline
                  ? "bg-emerald-500/15 text-emerald-300 border border-emerald-500/30"
                  : "bg-amber-500/15 text-amber-300 border border-amber-500/30"
              }`}
            >
              <span className={`h-1.5 w-1.5 rounded-full ${isOnline ? "bg-emerald-400" : "bg-amber-400"}`} />
              {isOnline ? "Online · Avto-sinxron" : "Offline Rejim"}
            </span>

            {overview && overview.pendingMutationsCount > 0 ? (
              <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold bg-amber-500/20 text-amber-300 border border-amber-500/30">
                {overview.pendingMutationsCount} ta kutilayotgan o‘zgarish
              </span>
            ) : overview && overview.collectionCount > 0 ? (
              <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                Sinxronlangan ✓
              </span>
            ) : null}
          </div>

          <div className="text-sm font-semibold text-white">
            Lug‘at va Fleshkartalar (IndexedDB)
          </div>

          <div className="text-xs text-slate-400">
            {loading ? (
              <span>Holat tekshirilmoqda…</span>
            ) : overview && overview.collectionCount > 0 ? (
              <span>
                {overview.collectionCount} ta to‘plam ({overview.totalWords} ta so‘z) saqlangan
                {overview.lastDownloadedAt ? ` · Yangilandi: ${new Date(overview.lastDownloadedAt).toLocaleDateString()}` : ""}
              </span>
            ) : (
              <span>Hali offline to‘plamlar yuklab olinmagan. Flashcard orqali yuklab oling.</span>
            )}
          </div>

          {syncError && (
            <div className="text-xs text-rose-400">
              Xatolik: {syncError}
            </div>
          )}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2 self-end sm:self-center">
        {isOnline && overview && overview.pendingMutationsCount > 0 && (
          <button
            type="button"
            onClick={handleManualSync}
            disabled={isSyncing}
            className="rounded-xl border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs font-semibold text-amber-300 hover:bg-amber-500/20 transition-all shadow-sm disabled:opacity-50"
          >
            {isSyncing ? "Sinxronlanmoqda…" : "Sinxronlash ⟳"}
          </button>
        )}

        <button
          type="button"
          onClick={() => onNavigate("vocabulary")}
          className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-2 text-xs font-bold text-emerald-300 hover:bg-emerald-500/20 transition-all shadow-sm"
        >
          Fleshkartalarni ochish →
        </button>
      </div>
    </div>
  );
}
