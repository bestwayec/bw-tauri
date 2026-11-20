import { useQuery } from "@tanstack/react-query";
import type { Route } from "@/App";
import { get } from "@/lib/api";
import type { GroupListItem } from "@/lib/group-contract.generated";
import type { SubmissionPage } from "./GradingQueue";

interface Props {
  teacherName: string | null;
  userId: string;
  onNavigate: (route: Route) => void;
}

function greeting(name: string | null): string {
  const hour = new Date().getHours();
  const part =
    hour < 5 ? "Xayrli tun" : hour < 12 ? "Xayrli tong" : hour < 18 ? "Xayrli kun" : "Xayrli kech";
  return `${part}${name ? `, ${name.split(" ")[0]} ustoz` : " ustoz"}`;
}

export default function TeacherDashboard({ teacherName, userId, onNavigate }: Props) {
  const groupsQuery = useQuery({
    queryKey: ["groups", userId, false, ""],
    queryFn: () => get<GroupListItem[]>("/v1/groups", { archived: false }),
    staleTime: 30_000,
  });

  const gradingQuery = useQuery({
    queryKey: ["teacher-submissions", userId],
    queryFn: ({ signal }) => get<SubmissionPage>("/v1/teacher/submissions", { limit: 5, withTotal: 1 }, { signal }),
    staleTime: 30_000,
  });

  const groups = groupsQuery.data ?? [];
  const totalStudents = groups.reduce((sum, g) => sum + (g.studentsCount ?? 0), 0);
  const submissions = gradingQuery.data?.items ?? [];
  const pendingCount = gradingQuery.data?.total ?? 0;

  return (
    <section className="space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-emerald-400">
            Teacher Command Center
          </p>
          <h1 className="mt-1 text-2xl font-black tracking-tight text-white sm:text-3xl">
            {greeting(teacherName)}
          </h1>
          <p className="mt-1 text-sm text-slate-400">
            Sinflaringiz, topshiriqlar, baholash navbati va o‘quvchilar monitoringi.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          <button
            type="button"
            onClick={() => onNavigate("groups")}
            className="btn-brand rounded-xl px-4 py-2 text-xs font-bold text-slate-950 shadow-md hover:scale-[1.02] transition-transform"
          >
            Yangi guruh ochish +
          </button>
          <button
            type="button"
            onClick={() => onNavigate("proctoring")}
            className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-3.5 py-2 text-xs font-semibold text-emerald-300 hover:bg-emerald-500/20 transition-all shadow-sm"
          >
            Jonli monitoring (Proctoring)
          </button>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <div className="flex items-center justify-between rounded-2xl border border-emerald-500/15 bg-[#111827] p-5 shadow-sm">
          <div>
            <p className="text-[11px] font-bold uppercase tracking-wider text-slate-400">Faol Sinflar</p>
            <p className="mt-1 text-2xl font-black text-white tabular-nums">
              {groupsQuery.isLoading ? "…" : groupsQuery.isError ? "—" : groups.length}
            </p>
            {groupsQuery.isError ? (
              <button
                type="button"
                onClick={() => void groupsQuery.refetch()}
                className="mt-0.5 text-[10px] text-red-300 underline font-semibold"
              >
                Yuklab bo‘lmadi · Qayta urinish ⟳
              </button>
            ) : (
              <p className="mt-0.5 text-[11px] text-slate-400">O‘quv guruhlari</p>
            )}
          </div>
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-lg">
            🏫
          </span>
        </div>

        <div className="flex items-center justify-between rounded-2xl border border-emerald-500/15 bg-[#111827] p-5 shadow-sm">
          <div>
            <p className="text-[11px] font-bold uppercase tracking-wider text-slate-400">Jami O‘quvchilar</p>
            <p className="mt-1 text-2xl font-black text-emerald-400 tabular-nums">
              {groupsQuery.isLoading ? "…" : groupsQuery.isError ? "—" : totalStudents}
            </p>
            {groupsQuery.isError ? (
              <p className="mt-0.5 text-[10px] text-slate-400">Guruhlar yuklanmadi</p>
            ) : (
              <p className="mt-0.5 text-[11px] text-slate-400">Biriktirilgan talabalar</p>
            )}
          </div>
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-lg">
            👥
          </span>
        </div>

        <div className="flex items-center justify-between rounded-2xl border border-emerald-500/15 bg-[#111827] p-5 shadow-sm">
          <div>
            <p className="text-[11px] font-bold uppercase tracking-wider text-slate-400">Tekshirish Navbati</p>
            <p className={`mt-1 text-2xl font-black tabular-nums ${gradingQuery.isError ? "text-red-400" : pendingCount > 0 ? "text-amber-400" : "text-white"}`}>
              {gradingQuery.isLoading ? "…" : gradingQuery.isError ? "—" : pendingCount}
            </p>
            {gradingQuery.isError ? (
              <button
                type="button"
                onClick={() => void gradingQuery.refetch()}
                className="mt-0.5 text-[10px] text-red-300 underline font-semibold"
              >
                Xatolik · Qayta urinish ⟳
              </button>
            ) : (
              <p className="mt-0.5 text-[11px] text-slate-400">Writing & Speaking ishlari</p>
            )}
          </div>
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-amber-500/10 border border-amber-500/20 text-lg">
            📝
          </span>
        </div>

        <div className="flex items-center justify-between rounded-2xl border border-emerald-500/15 bg-[#111827] p-5 shadow-sm">
          <div>
            <p className="text-[11px] font-bold uppercase tracking-wider text-slate-400">Lug‘at Studiyasi</p>
            <p className="mt-1 text-2xl font-black text-white tabular-nums">To‘plamlar</p>
            <button
              type="button"
              onClick={() => onNavigate("vocabulary")}
              className="mt-0.5 text-[11px] font-semibold text-emerald-400 hover:underline"
            >
              Studiyani ochish →
            </button>
          </div>
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-purple-500/10 border border-purple-500/20 text-lg">
            📖
          </span>
        </div>
      </div>

      {/* Main Grid: My Classrooms + Grading Queue Preview */}
      <div className="grid gap-6 lg:grid-cols-12">
        {/* Classrooms List (8 cols) */}
        <div className="space-y-4 lg:col-span-8">
          <div className="flex items-center justify-between">
            <h2 className="text-base font-bold text-white flex items-center gap-2">
              <span>🏫</span>
              <span>Mening Sinflarim ({groups.length})</span>
            </h2>
            <button
              type="button"
              onClick={() => onNavigate("groups")}
              className="text-xs font-semibold text-emerald-400 hover:text-emerald-300"
            >
              Barchasini boshqarish →
            </button>
          </div>

          {groupsQuery.isLoading && (
            <div className="space-y-2 animate-pulse">
              <div className="h-20 rounded-2xl bg-slate-800/50" />
              <div className="h-20 rounded-2xl bg-slate-800/50" />
            </div>
          )}

          {groupsQuery.isError && (
            <div role="alert" className="rounded-2xl border border-red-500/30 bg-red-500/10 p-4 text-xs text-red-300 flex items-center justify-between">
              <span>Guruhlarni yuklashda xatolik yuz berdi.</span>
              <button
                type="button"
                onClick={() => void groupsQuery.refetch()}
                className="rounded-lg bg-red-500/20 px-3 py-1 font-semibold text-red-200 hover:bg-red-500/30 transition-all"
              >
                Qayta urinish ⟳
              </button>
            </div>
          )}

          {!groupsQuery.isLoading && !groupsQuery.isError && groups.length === 0 && (
            <div className="rounded-2xl border border-white/10 bg-[#111827] p-8 text-center space-y-3">
              <p className="text-sm font-semibold text-slate-200">Hozircha biriktirilgan sinf yo‘q</p>
              <p className="text-xs text-slate-400">
                O‘quvchilaringiz uchun yangi guruh yarating va taklif kodini ulashing.
              </p>
              <button
                type="button"
                onClick={() => onNavigate("groups")}
                className="btn-brand rounded-xl px-4 py-2 text-xs font-bold text-slate-950"
              >
                Guruh ochish
              </button>
            </div>
          )}

          {!groupsQuery.isLoading && !groupsQuery.isError && groups.length > 0 && (
            <div className="grid gap-3 sm:grid-cols-2">
              {groups.map((group) => (
                <div
                  key={group.id}
                  className="flex flex-col justify-between rounded-2xl border border-emerald-500/15 bg-[#111827] p-4 shadow-sm hover:border-emerald-500/35 transition-all"
                >
                  <div className="space-y-2">
                    <div className="flex items-center justify-between gap-2">
                      <h3 className="font-bold text-white text-base truncate">{group.name}</h3>
                      <span className="rounded-md bg-emerald-500/10 border border-emerald-500/20 px-2 py-0.5 text-[10px] font-bold text-emerald-300 shrink-0">
                        {group.studentsCount ?? 0} o‘quvchi
                      </span>
                    </div>

                    <p className="text-xs text-slate-400">
                      {group.teacherName ? `Ustoz: ${group.teacherName}` : "Guruh faol"} · ID: <code className="font-mono text-slate-300">{group.id.slice(0, 8)}</code>
                    </p>
                  </div>

                  <div className="mt-4 flex items-center justify-between pt-3 border-t border-white/5">
                    <button
                      type="button"
                      onClick={() => onNavigate("groups")}
                      className="text-xs font-bold text-emerald-400 hover:text-emerald-300"
                    >
                      Ish maydoni →
                    </button>
                    <button
                      type="button"
                      onClick={() => onNavigate("groups")}
                      className="text-[11px] text-slate-400 hover:text-white"
                    >
                      Davomat & Vazifalar
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Grading Queue Preview (4 cols) */}
        <div className="space-y-4 lg:col-span-4">
          <div className="flex items-center justify-between">
            <h2 className="text-base font-bold text-white flex items-center gap-2">
              <span>✍️</span>
              <span>Tekshirish navbati</span>
            </h2>
            {pendingCount > 0 && (
              <span className="rounded-full bg-amber-500/20 border border-amber-500/30 px-2 py-0.5 text-xs font-bold text-amber-300">
                {pendingCount} ta
              </span>
            )}
          </div>

          <div className="rounded-2xl border border-emerald-500/15 bg-[#111827] p-4 shadow-sm space-y-3">
            {gradingQuery.isLoading && (
              <div className="space-y-2 animate-pulse">
                <div className="h-12 rounded-xl bg-slate-800/50" />
                <div className="h-12 rounded-xl bg-slate-800/50" />
              </div>
            )}

            {gradingQuery.isError && (
              <div role="alert" className="rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-xs text-red-300 space-y-2">
                <p>Tekshirish navbatini yuklashda xatolik yuz berdi.</p>
                <button
                  type="button"
                  onClick={() => void gradingQuery.refetch()}
                  className="rounded-lg bg-red-500/20 px-2.5 py-1 font-semibold text-red-200 hover:bg-red-500/30 transition-all"
                >
                  Qayta urinish ⟳
                </button>
              </div>
            )}

            {!gradingQuery.isLoading && !gradingQuery.isError && submissions.length === 0 && (
              <p className="text-xs text-slate-400 py-4 text-center">
                Barcha topshirilgan ishlar tekshirilgan.
              </p>
            )}

            {!gradingQuery.isLoading && !gradingQuery.isError && submissions.length > 0 && (
              <ul className="space-y-2">
                {submissions.slice(0, 5).map((sub) => (
                  <li
                    key={sub.id}
                    className="flex items-center justify-between gap-2 rounded-xl border border-white/5 bg-slate-900/50 p-2.5 hover:border-emerald-500/20 transition-all"
                  >
                    <div className="min-w-0">
                      <p className="text-xs font-bold text-white truncate">{sub.studentName || "O‘quvchi"}</p>
                      <p className="text-[10px] text-slate-400 truncate">
                        {sub.examTitle} · <span className="uppercase text-emerald-400">{sub.skill}</span>
                      </p>
                    </div>

                    <button
                      type="button"
                      onClick={() => onNavigate("grading")}
                      className="shrink-0 rounded-lg border border-amber-500/30 bg-amber-500/10 px-2.5 py-1 text-[11px] font-bold text-amber-300 hover:bg-amber-500/20 transition-all"
                    >
                      Baholash
                    </button>
                  </li>
                ))}
              </ul>
            )}

            <button
              type="button"
              onClick={() => onNavigate("grading")}
              className="w-full rounded-xl border border-white/10 bg-slate-800/40 p-2 text-center text-xs font-semibold text-slate-300 hover:bg-slate-800 hover:text-white transition-all"
            >
              To‘liq baholash stolini ochish →
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}
