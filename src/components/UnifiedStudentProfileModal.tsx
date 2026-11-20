import { useEffect, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { get } from "@/lib/api";
import type { ClassroomStudentHistory } from "@/lib/group-contract.generated";

interface Props {
  groupId: string;
  studentId: string;
  userId: string;
  onClose: () => void;
}

export function UnifiedStudentProfileModal({ groupId, studentId, userId, onClose }: Props) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    const opener = document.activeElement;
    dialog.showModal();
    return () => {
      dialog.close();
      if (opener instanceof HTMLElement && opener.isConnected) opener.focus();
    };
  }, []);

  const path = `/v1/groups/${encodeURIComponent(groupId)}/member-history/${encodeURIComponent(studentId)}`;
  const { data, isPending, isFetchedAfterMount, isError, refetch } = useQuery<ClassroomStudentHistory>({
    queryKey: ["classroom-student-history", userId, groupId, studentId],
    queryFn: ({ signal }) => get<ClassroomStudentHistory>(path, undefined, { signal }),
    enabled: Boolean(groupId && studentId),
    refetchOnMount: "always",
    gcTime: 0,
  });

  const history = isFetchedAfterMount && !isError ? data : undefined;
  const isLoading = isPending || (!isError && !isFetchedAfterMount);
  const attendance = history?.attendance ?? [];
  const presentCount = attendance.filter((a) => a.state === "present").length;
  const attendancePct = attendance.length > 0 ? Math.round((presentCount / attendance.length) * 100) : null;

  const homework = history?.homework ?? [];
  const passedHomework = homework.filter((h) => h.is_passed).length;

  const mocks = history?.mockExams ?? [];
  const tests = history?.tests ?? [];
  const allExamsCount = mocks.length + tests.length;

  const feedbackList = history?.feedback ?? [];

  return (
    <dialog
      ref={dialogRef}
      className="m-auto max-h-[90vh] w-[calc(100%-2rem)] max-w-2xl bg-transparent p-0 text-white backdrop:bg-black/75"
      aria-modal="true"
      aria-labelledby="student-profile-title"
      onCancel={(e) => { e.preventDefault(); onClose(); }}
      onClick={(e) => {
        if (e.target === e.currentTarget) {
          onClose();
        }
      }}
    >
      <div className="relative flex max-h-[90vh] w-full max-w-2xl flex-col rounded-3xl border border-emerald-500/30 bg-[#0B0F17] p-6 shadow-2xl overflow-hidden">
        {/* Modal Header */}
        <div className="flex items-start justify-between border-b border-white/10 pb-4">
          <div className="flex items-center gap-3">
            <div className="grid h-12 w-12 place-items-center rounded-2xl bg-emerald-500/15 border border-emerald-500/30 text-emerald-400 font-bold text-lg">
              {history?.name ? history.name.charAt(0).toUpperCase() : "👤"}
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 id="student-profile-title" className="text-xl font-bold text-white">
                  {history?.name || "O‘quvchi profili"}
                </h2>
                {history && (
                  <span
                    className={`rounded-full px-2.5 py-0.5 text-[10px] font-bold ${
                      history.currentlyEnrolled
                        ? "bg-emerald-500/20 text-emerald-300 border border-emerald-500/40"
                        : "bg-slate-700/80 text-slate-300 border border-slate-600"
                    }`}
                  >
                    {history.currentlyEnrolled ? "Faol a‘zo (Hozirgi sinf)" : "Sobiq a‘zo (Tarixiy sinf)"}
                  </span>
                )}
              </div>
              <p className="text-xs text-slate-400">
                Sinf: <span className="text-white font-medium">{history?.groupName || "..."}</span> · ID:{" "}
                <code className="font-mono text-slate-300">{studentId.slice(0, 8)}</code>
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="grid h-8 w-8 place-items-center rounded-xl border border-white/10 text-slate-400 hover:bg-slate-800 hover:text-white transition-colors"
            aria-label="Yopish"
          >
            ✕
          </button>
        </div>

        {/* Modal Body */}
        <div className="flex-1 overflow-y-auto py-4 space-y-5 pr-1">
          {isLoading && (
            <div className="space-y-3 animate-pulse">
              <div className="grid grid-cols-3 gap-3">
                <div className="h-20 rounded-2xl bg-slate-800/50" />
                <div className="h-20 rounded-2xl bg-slate-800/50" />
                <div className="h-20 rounded-2xl bg-slate-800/50" />
              </div>
              <div className="h-32 rounded-2xl bg-slate-800/50" />
            </div>
          )}

          {isError && (
            <div role="alert" className="rounded-2xl border border-red-500/30 bg-red-500/10 p-4 text-xs text-red-300">
              O‘quvchi ma‘lumotlarini yuklab bo‘lmadi.{" "}
              <button type="button" onClick={() => void refetch()} className="underline font-bold">
                Qayta urinish
              </button>
            </div>
          )}

          {!isLoading && !isError && history && (
            <>
              {/* Summary KPIs */}
              <div className="grid grid-cols-3 gap-3">
                <div className="rounded-2xl border border-white/10 bg-slate-900/60 p-3.5 text-center">
                  <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Davomat</p>
                  <p className="mt-1 text-xl font-black text-emerald-400">
                    {attendancePct !== null ? `${attendancePct}%` : "—"}
                  </p>
                  <p className="text-[10px] text-slate-400 mt-0.5">
                    {presentCount} / {attendance.length} dars
                  </p>
                </div>

                <div className="rounded-2xl border border-white/10 bg-slate-900/60 p-3.5 text-center">
                  <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Vazifalar</p>
                  <p className="mt-1 text-xl font-black text-white">
                    {passedHomework} / {homework.length}
                  </p>
                  <p className="text-[10px] text-slate-400 mt-0.5">Bajarilgan</p>
                </div>

                <div className="rounded-2xl border border-white/10 bg-slate-900/60 p-3.5 text-center">
                  <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Imtihonlar</p>
                  <p className="mt-1 text-xl font-black text-purple-400">
                    {allExamsCount} ta
                  </p>
                  <p className="text-[10px] text-slate-400 mt-0.5">Topshirilgan</p>
                </div>
              </div>

              {/* 1. Imtihonlar tarixi */}
              <section className="space-y-2">
                <h3 className="text-sm font-bold text-white flex items-center gap-2">
                  <span>📊</span> Imtihonlar natijalari ({allExamsCount})
                </h3>
                {allExamsCount === 0 ? (
                  <p className="text-xs text-slate-400">Hozircha topshirilgan imtihonlar yo‘q.</p>
                ) : (
                  <ul className="space-y-1.5">
                    {mocks.map((m) => (
                      <li
                        key={m.id}
                        className="flex items-center justify-between rounded-xl border border-white/5 bg-slate-900/40 px-3 py-2 text-xs"
                      >
                        <span className="font-medium text-slate-200">{m.exam__title || "Mock imtihon"}</span>
                        <span className="font-mono font-bold text-emerald-400">
                          {m.overall_band != null ? `Band ${m.overall_band}` : m.overall_score != null ? `${m.overall_score} pts` : "—"}
                        </span>
                      </li>
                    ))}
                    {tests.map((t) => (
                      <li
                        key={t.id}
                        className="flex items-center justify-between rounded-xl border border-white/5 bg-slate-900/40 px-3 py-2 text-xs"
                      >
                        <span className="font-medium text-slate-200">{t.test__title || "Standart test"}</span>
                        <span className="font-mono font-bold text-white">
                          {t.total_score != null ? `${t.total_score} ball` : "—"}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </section>

              {/* 2. Uy vazifalari va Lug‘at */}
              <section className="space-y-2">
                <h3 className="text-sm font-bold text-white flex items-center gap-2">
                  <span>📚</span> Uy vazifalari va Lug‘at ({homework.length})
                </h3>
                {homework.length === 0 ? (
                  <p className="text-xs text-slate-400">Biriktirilgan vazifalar yo‘q.</p>
                ) : (
                  <ul className="space-y-1.5">
                    {homework.map((h) => (
                      <li
                        key={h.assignment_id}
                        className="flex items-center justify-between rounded-xl border border-white/5 bg-slate-900/40 px-3 py-2 text-xs"
                      >
                        <span className="font-medium text-slate-200 truncate max-w-xs">{h.assignment__title}</span>
                        <span
                          className={`font-mono font-bold ${
                            h.is_passed ? "text-emerald-400" : h.status === "graded" ? "text-red-400" : "text-amber-400"
                          }`}
                        >
                          {h.score_percent != null ? `${h.score_percent}%` : h.status}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </section>

              {/* 3. Davomat tarixi */}
              <section className="space-y-2">
                <h3 className="text-sm font-bold text-white flex items-center gap-2">
                  <span>📅</span> Davomat qaydlari ({attendance.length})
                </h3>
                {attendance.length === 0 ? (
                  <p className="text-xs text-slate-400">Davomat belgilari mavjud emas.</p>
                ) : (
                  <div className="flex flex-wrap gap-1.5">
                    {attendance.slice(0, 16).map((mark) => (
                      <span
                        key={mark.date}
                        className={`rounded-md border px-2 py-0.5 text-[10px] font-mono ${
                          mark.state === "present"
                            ? "bg-emerald-500/20 text-emerald-300 border-emerald-500/40"
                            : mark.state === "late"
                            ? "bg-amber-500/20 text-amber-300 border-amber-500/40"
                            : "bg-red-500/20 text-red-300 border-red-500/40"
                        }`}
                      >
                        {mark.date} · {{ present: "Keldi", late: "Kechikdi", absent: "Kelmadi" }[mark.state]}
                      </span>
                    ))}
                  </div>
                )}
              </section>

              {/* 4. Tasdiqlangan izohlar (Teacher & AI Feedback) */}
              {feedbackList.length > 0 && (
                <section className="space-y-2">
                  <h3 className="text-sm font-bold text-white flex items-center gap-2">
                    <span>💬</span> Ustoz va Diagnostika Izohlari ({feedbackList.length})
                  </h3>
                  <div className="space-y-2">
                    {feedbackList.map((f, idx) => {
                      const text =
                        f.feedback_text?.trim() ||
                        (typeof f.approved_feedback === "string" ? f.approved_feedback.trim() : "");
                      if (!text) return null;
                      return (
                        <div
                          key={idx}
                          className="rounded-xl border border-white/10 bg-slate-900/60 p-3 space-y-1 text-xs"
                        >
                          <div className="flex items-center justify-between">
                            <span className="font-bold uppercase text-emerald-400">{f.skill}</span>
                            <span className="font-mono text-white">Ball: {f.final_score ?? "—"}</span>
                          </div>
                          <p className="text-slate-300 whitespace-pre-wrap leading-relaxed">
                            {text}
                          </p>
                        </div>
                      );
                    })}
                  </div>
                </section>
              )}
            </>
          )}
        </div>

        {/* Modal Footer */}
        <div className="border-t border-white/10 pt-3 flex justify-end">
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl border border-white/10 bg-slate-800 px-4 py-2 text-xs font-semibold text-white hover:bg-slate-700 transition-colors"
          >
            Yopish
          </button>
        </div>
      </div>
    </dialog>
  );
}
