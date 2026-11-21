import { useRef, useState, type KeyboardEvent } from "react";
import { useQuery } from "@tanstack/react-query";
import { fetchMyAssignments, type StudentAssignmentItem } from "@/lib/assignments";
import type { Route } from "@/App";
import { StatusBadge } from "@/components/common/StatusBadge";

interface Props {
  userId?: string;
  onNavigate: (route: Route) => void;
  onStartExam?: (assignmentId: string) => void;
  onSelectVocabulary?: (assignmentId: string) => void;
}

const TABS = ["active", "all", "completed"] as const;
type Tab = (typeof TABS)[number];

function scoreSuffix(score: number | null | undefined): string {
  return typeof score === "number" && Number.isFinite(score) ? ` (${Math.round(score)}%)` : "";
}

function formatDeadline(iso: string): string {
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    return d.toLocaleString("uz-UZ", {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

export function StudentAssignmentsWidget({ userId, onNavigate, onStartExam, onSelectVocabulary }: Props) {
  const { data: assignments, isLoading, isError, refetch } = useQuery<StudentAssignmentItem[]>({
    queryKey: ["my-assignments", userId],
    queryFn: fetchMyAssignments,
    staleTime: 30_000,
    refetchInterval: 60_000,
  });

  const [tab, setTab] = useState<Tab>("active");
  const tabRefs = useRef<Record<Tab, HTMLButtonElement | null>>({ active: null, all: null, completed: null });
  const onTabKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    const index = TABS.indexOf(tab);
    let next: Tab | null = null;
    if (event.key === "ArrowRight") next = TABS[(index + 1) % TABS.length];
    else if (event.key === "ArrowLeft") next = TABS[(index + TABS.length - 1) % TABS.length];
    else if (event.key === "Home") next = TABS[0];
    else if (event.key === "End") next = TABS[TABS.length - 1];
    if (!next) return;
    event.preventDefault();
    setTab(next);
    tabRefs.current[next]?.focus();
  };

  const activeAssignments = (assignments ?? []).filter(
    (a) => a.status === "pending" || a.status === "overdue" || a.status === "awaiting_review"
  );
  const completedAssignments = (assignments ?? []).filter(
    (a) => a.status === "passed" || a.status === "failed"
  );

  const displayedAssignments =
    tab === "active"
      ? activeAssignments
      : tab === "completed"
      ? completedAssignments
      : assignments ?? [];

  return (
    <section className="rounded-2xl border border-emerald-500/20 bg-[#111827] p-5 shadow-sm space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <span className="grid h-8 w-8 place-items-center rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-emerald-400">
            📝
          </span>
          <div>
            <h2 className="text-base font-bold text-white">Sinf topshiriqlari va uy vazifalari</h2>
            <p className="text-xs text-slate-400">
              {isLoading || isError || !assignments ? null : activeAssignments.length > 0
                ? `${activeAssignments.length} ta faol topshiriq mavjud`
                : assignments.length > 0
                ? "Barcha topshiriqlar bajarilgan"
                : "Hozircha topshiriq berilmagan"}
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {assignments && assignments.length > 0 && (
            <div className="flex rounded-xl border border-white/10 bg-slate-900/60 p-0.5" role="tablist" aria-label="Topshiriqlar filtri">
              <button
                type="button"
                role="tab"
                id="assignments-tab-active"
                ref={(node) => { tabRefs.current.active = node; }}
                aria-selected={tab === "active"}
                aria-controls="assignments-panel"
                tabIndex={tab === "active" ? 0 : -1}
                onKeyDown={onTabKeyDown}
                onClick={() => setTab("active")}
                className={`rounded-lg px-2.5 py-1 text-xs font-semibold transition-all ${
                  tab === "active" ? "bg-emerald-500 text-slate-950 font-bold" : "text-slate-300 hover:text-white"
                }`}
              >
                Faol ({activeAssignments.length})
              </button>
              <button
                type="button"
                role="tab"
                id="assignments-tab-all"
                ref={(node) => { tabRefs.current.all = node; }}
                aria-selected={tab === "all"}
                aria-controls="assignments-panel"
                tabIndex={tab === "all" ? 0 : -1}
                onKeyDown={onTabKeyDown}
                onClick={() => setTab("all")}
                className={`rounded-lg px-2.5 py-1 text-xs font-semibold transition-all ${
                  tab === "all" ? "bg-emerald-500 text-slate-950 font-bold" : "text-slate-300 hover:text-white"
                }`}
              >
                Barchasi ({assignments.length})
              </button>
              <button
                type="button"
                role="tab"
                id="assignments-tab-completed"
                ref={(node) => { tabRefs.current.completed = node; }}
                aria-selected={tab === "completed"}
                aria-controls="assignments-panel"
                tabIndex={tab === "completed" ? 0 : -1}
                onKeyDown={onTabKeyDown}
                onClick={() => setTab("completed")}
                className={`rounded-lg px-2.5 py-1 text-xs font-semibold transition-all ${
                  tab === "completed" ? "bg-emerald-500 text-slate-950 font-bold" : "text-slate-300 hover:text-white"
                }`}
              >
                Tugallangan ({completedAssignments.length})
              </button>
            </div>
          )}

          <button
            type="button"
            onClick={() => void refetch()}
            className="text-xs text-slate-400 hover:text-emerald-300 transition-colors"
            title="Yangilash"
          >
            Yangilash ⟳
          </button>
        </div>
      </div>

      {isLoading && (
        <div className="space-y-2 animate-pulse">
          <div className="h-14 rounded-xl bg-slate-800/60" />
          <div className="h-14 rounded-xl bg-slate-800/60" />
        </div>
      )}

      {isError && (
        <div role="alert" className="rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-xs text-red-300">
          Topshiriqlarni yuklashda xatolik yuz berdi.{" "}
          <button type="button" onClick={() => void refetch()} className="underline font-semibold">
            Qayta urinish
          </button>
        </div>
      )}

      {!isLoading && !isError && assignments?.length === 0 && (
        <div className="rounded-xl border border-white/10 bg-slate-900/50 p-6 text-center">
          <p className="text-sm font-medium text-slate-300">Hozircha biriktirilgan vazifalar yo‘q</p>
          <p className="text-xs text-slate-400 mt-1">O‘qituvchingiz vazifa berganda bu yerda paydo bo‘ladi.</p>
        </div>
      )}

      {!isLoading && !isError && assignments && assignments.length > 0 && (
        <div className="space-y-3" role="tabpanel" id="assignments-panel" aria-labelledby={`assignments-tab-${tab}`}>
          {displayedAssignments.length === 0 ? (
            <p className="text-xs text-slate-400 text-center py-4">
              Ushbu bo‘limda topshiriqlar mavjud emas.
            </p>
          ) : (
            <ul className="space-y-2">
              {displayedAssignments.map((task) => (
                <li
                  key={task.id}
                  className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 rounded-xl border border-white/10 bg-slate-900/60 p-3.5 transition-all hover:border-emerald-500/30"
                >
                  <div className="space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-semibold text-sm text-white">{task.title}</span>
                      <span className="text-xs text-slate-400">· {task.cohort_name}</span>
                      {task.status === "overdue" && (
                        <StatusBadge variant="danger">Muddati o‘tgan</StatusBadge>
                      )}
                      {task.status === "awaiting_review" && (
                        <StatusBadge variant="amber">Tekshirilmoqda</StatusBadge>
                      )}
                      {task.status === "passed" && (
                        <StatusBadge variant="brand">Bajarildi{scoreSuffix(task.score_percent)}</StatusBadge>
                      )}
                      {task.status === "failed" && (
                        <StatusBadge variant="danger">O‘tmadi{scoreSuffix(task.score_percent)}</StatusBadge>
                      )}
                      {task.status === "pending" && (
                        <StatusBadge variant="info">Faol</StatusBadge>
                      )}
                    </div>
                    <p className="text-xs text-slate-400">
                      Muddat: <span className="font-mono text-slate-300">{formatDeadline(task.deadline)}</span>
                      {task.min_pass_percent ? ` · O‘tish bali: ${task.min_pass_percent}%` : ""}
                    </p>
                  </div>

                  <div className="flex items-center gap-2 self-end sm:self-center">
                    {task.vocabulary_set_id && (
                      <button
                        type="button"
                        onClick={() => {
                          if (onSelectVocabulary) {
                            onSelectVocabulary(task.id);
                          } else {
                            onNavigate("vocabulary");
                          }
                        }}
                        className="btn-brand rounded-lg px-3 py-1.5 text-xs font-bold text-slate-950 shadow-sm hover:scale-105 transition-transform"
                      >
                        Lug‘atni o‘rganish →
                      </button>
                    )}
                    {task.exam_id && onStartExam && (task.can_launch_exam ?? task.status === "pending") && (
                      <button
                        type="button"
                        onClick={() => onStartExam(task.id)}
                        className="btn-brand rounded-lg px-3 py-1.5 text-xs font-bold text-slate-950 shadow-sm hover:scale-105 transition-transform"
                      >
                        Imtihonni boshlash →
                      </button>
                    )}
                    {!task.vocabulary_set_id && !task.exam_id && (
                      <span className="text-xs text-slate-400">Amaliy topshiriq</span>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}
