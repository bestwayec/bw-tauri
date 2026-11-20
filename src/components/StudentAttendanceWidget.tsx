import { useQuery } from "@tanstack/react-query";
import { fetchMyAttendance, type StudentAttendanceItem } from "@/lib/assignments";

function currentYearMonth(): string {
  const d = new Date();
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  return `${year}-${month}`;
}

export function StudentAttendanceWidget({ userId }: { userId: string }) {
  const month = currentYearMonth();
  const { data: records, isLoading, isError, refetch } = useQuery<StudentAttendanceItem[]>({
    queryKey: ["my-attendance", userId, month],
    queryFn: ({ signal }) => fetchMyAttendance(month, signal),
    staleTime: 60_000,
  });

  const presentCount = (records ?? []).filter((r) => r.state === "present").length;
  const lateCount = (records ?? []).filter((r) => r.state === "late").length;
  const absentCount = (records ?? []).filter((r) => r.state === "absent").length;
  const totalDays = (records ?? []).length;
  const attendancePct = totalDays > 0 ? Math.round(((presentCount + lateCount) / totalDays) * 100) : null;

  return (
    <section className="rounded-2xl border border-emerald-500/20 bg-[#111827] p-5 shadow-sm space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="grid h-8 w-8 place-items-center rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-emerald-400">
            📅
          </span>
          <div>
            <h3 className="text-sm font-bold text-white">Davomat (Joriy oy)</h3>
            <p className="text-[11px] text-slate-400">
              {!isError && totalDays > 0 ? `${totalDays} dars belgilangan` : "Davomat ma'lumotlari"}
            </p>
          </div>
        </div>

        {!isError && attendancePct !== null && (
          <span className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-1 text-xs font-black text-emerald-300">
            {attendancePct}% Ishtirok
          </span>
        )}
      </div>

      {isLoading && (
        <div className="h-12 rounded-xl bg-slate-800/50 animate-pulse" />
      )}

      {isError && (
        <div role="alert" className="rounded-xl border border-red-500/30 bg-red-500/10 p-2.5 text-xs text-red-300 flex items-center justify-between">
          <span>Davomatni yuklab bo‘lmadi.</span>
          <button type="button" onClick={() => void refetch()} className="underline font-semibold ml-2 hover:text-white">
            Qayta urinish
          </button>
        </div>
      )}

      {!isLoading && !isError && totalDays === 0 && (
        <p className="text-xs text-slate-400">Joriy oyda dars davomati hali qayd etilmagan.</p>
      )}

      {!isLoading && !isError && totalDays > 0 && (
        <div className="space-y-2">
          <div className="grid grid-cols-3 gap-2 text-center text-xs">
            <div className="rounded-xl border border-white/5 bg-slate-900/60 p-2">
              <span className="block text-[10px] text-slate-400">Kelgan</span>
              <span className="text-sm font-bold text-emerald-400">{presentCount}</span>
            </div>
            <div className="rounded-xl border border-white/5 bg-slate-900/60 p-2">
              <span className="block text-[10px] text-slate-400">Kechikkan</span>
              <span className="text-sm font-bold text-amber-400">{lateCount}</span>
            </div>
            <div className="rounded-xl border border-white/5 bg-slate-900/60 p-2">
              <span className="block text-[10px] text-slate-400">Kelmadi</span>
              <span className="text-sm font-bold text-red-400">{absentCount}</span>
            </div>
          </div>

          <div className="flex flex-wrap gap-1.5 pt-1">
            {(records ?? []).slice(-8).map((record) => {
              const color =
                record.state === "present"
                  ? "bg-emerald-500/20 text-emerald-300 border-emerald-500/40"
                  : record.state === "late"
                  ? "bg-amber-500/20 text-amber-300 border-amber-500/40"
                  : "bg-red-500/20 text-red-300 border-red-500/40";
              const label = record.state === "present" ? "✓" : record.state === "late" ? "⏱" : "✕";
              return (
                <span
                  key={record.date}
                  className={`inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-[10px] font-mono font-medium ${color}`}
                  title={`${record.date}: ${record.state}`}
                >
                  {record.date.slice(5)} {label}
                </span>
              );
            })}
          </div>
        </div>
      )}
    </section>
  );
}
