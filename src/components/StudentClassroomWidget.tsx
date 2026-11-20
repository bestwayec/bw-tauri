import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { joinCohortByCode } from "@/lib/assignments";
import { get } from "@/lib/api";
import type { GroupListItem } from "@/lib/group-contract.generated";

export function StudentClassroomWidget({ userId }: { userId: string }) {
  const queryClient = useQueryClient();
  const groupKey = ["student-classroom", userId] as const;
  const classroom = useQuery({
    queryKey: groupKey,
    queryFn: async ({ signal }) => {
      const groups = await get<GroupListItem[]>("/v1/groups", undefined, { signal });
      if (!Array.isArray(groups)) throw new Error("Invalid classroom data");
      return groups[0] ?? null;
    },
  });
  const group = classroom.isSuccess ? classroom.data : null;

  const [code, setCode] = useState("");
  const [showJoinModal, setShowJoinModal] = useState(false);
  const [message, setMessage] = useState<{ text: string; error: boolean } | null>(null);

  const joinMutation = useMutation({
    mutationFn: (inviteCode: string) => joinCohortByCode(inviteCode),
    onSuccess: (data) => {
      setMessage({ text: `Guruhga muvaffaqiyatli qo'shildingiz: ${data.cohort_name}`, error: false });
      setCode("");
      setShowJoinModal(false);
      void queryClient.invalidateQueries({ queryKey: ["my-assignments"] });
      void queryClient.invalidateQueries({ queryKey: groupKey });
    },
    onError: (err: unknown) => {
      const msg = typeof err === "object" && err && "message" in err ? String(err.message) : "Taklif kodi noto'g'ri yoki guruh topilmadi.";
      setMessage({ text: msg, error: true });
    },
  });

  return (
    <div className="rounded-2xl border border-emerald-500/20 bg-[#111827] p-4 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-400">
            <svg className="size-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
              <circle cx="9" cy="7" r="4" />
              <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
              <path d="M16 3.13a4 4 0 0 1 0 7.75" />
            </svg>
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Guruh / Sinf</span>
              {group && (
                <span className="rounded-md bg-emerald-500/15 px-2 py-0.5 text-[10px] font-bold text-emerald-300">
                  Faol a'zo
                </span>
              )}
            </div>
            <p className="font-bold text-white text-base">
              {classroom.isPending ? "Sinf yuklanmoqda… / Loading classroom…"
                : classroom.isError ? "Sinf yuklanmadi / Could not load classroom"
                : group?.name ?? "Guruhga biriktirilmagan"}
            </p>
            {group && (
              <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-slate-300">
                {group.teacherName && (
                  <span className="inline-flex items-center gap-1 text-emerald-400 font-medium">
                    👨‍🏫 {group.teacherName}
                  </span>
                )}
                {typeof group.studentsCount === "number" && (
                  <span className="text-slate-400">
                    · 👥 {group.studentsCount} ta o‘quvchi
                  </span>
                )}
                {group.schedule && group.schedule.length > 0 && (
                  <span className="text-slate-400">
                    · ⏰ {group.schedule.map(s => `${s.day.toUpperCase()} ${s.startTime}-${s.endTime}`).join(", ")}
                  </span>
                )}
              </div>
            )}
          </div>
        </div>

        <div className="flex items-center gap-3">
          {classroom.isError && (
            <button type="button" onClick={() => void classroom.refetch()} className="text-xs underline">
              Qayta urinish / Retry
            </button>
          )}

          <button
            type="button"
            onClick={() => setShowJoinModal(true)}
            className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-xs font-semibold text-emerald-300 hover:bg-emerald-500/20 transition-all"
          >
            {group ? "Boshqa guruh kodi" : "Guruh kodini kiritish →"}
          </button>
        </div>
      </div>

      {message && (
        <div
          role="alert"
          className={`mt-3 rounded-xl border p-2.5 text-xs ${
            message.error
              ? "border-red-500/30 bg-red-500/10 text-red-300"
              : "border-emerald-500/30 bg-emerald-500/10 text-emerald-300"
          }`}
        >
          {message.text}
        </div>
      )}

      {showJoinModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm">
          <div className="w-full max-w-sm rounded-2xl border border-emerald-500/30 bg-[#111827] p-5 shadow-2xl space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-base font-bold text-white">Guruhga qo‘shilish</h3>
              <button
                type="button"
                onClick={() => setShowJoinModal(false)}
                className="text-slate-400 hover:text-white text-sm"
              >
                ✕
              </button>
            </div>
            <p className="text-xs text-slate-300">
              O‘qituvchingiz bergan 6 belgili taklif kodini kiriting (masalan: <code className="text-emerald-300">BW-1234</code>):
            </p>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                if (code.trim().length >= 3 && !joinMutation.isPending) {
                  joinMutation.mutate(code);
                }
              }}
              className="space-y-3"
            >
              <input
                type="text"
                value={code}
                onChange={(e) => setCode(e.target.value.toUpperCase())}
                placeholder="BW-XXXX"
                maxLength={10}
                required
                className="w-full rounded-xl border border-white/15 bg-slate-900 px-3 py-2.5 text-center text-sm font-mono tracking-widest text-white uppercase focus:border-emerald-500 focus:outline-none"
              />
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setShowJoinModal(false)}
                  className="w-1/2 rounded-xl border border-white/10 px-3 py-2 text-xs font-medium text-slate-300 hover:bg-slate-800"
                >
                  Bekor qilish
                </button>
                <button
                  type="submit"
                  disabled={code.trim().length < 3 || joinMutation.isPending}
                  className="w-1/2 btn-brand rounded-xl px-3 py-2 text-xs font-bold text-slate-950 disabled:opacity-50"
                >
                  {joinMutation.isPending ? "Qo‘shilmoqda…" : "Qo‘shilish"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
