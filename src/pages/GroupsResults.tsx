import { useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ClassroomSchedule } from "../components/ClassroomSchedule";
import { ClassroomHistory } from "./ClassroomHistory";
import ClassroomWorkspace from "./ClassroomWorkspace";
import { downloadBlob, get, post, put } from "../lib/api";
import type { ClassroomArchiveState, GroupDetail, GroupInput, GroupListItem, ScheduleItem } from "../lib/group-contract.generated";

const inputStyle = "rounded-lg border border-white/15 bg-surface px-3 py-2 text-sm";
const reportRoutes = { xlsx: "export/excel", csv: "export", pdf: "report/pdf" } as const;

function errorMessage(error: unknown) {
  if (typeof error === "object" && error && "message" in error && typeof error.message === "string") {
    return error.message;
  }
  return "So‘rov bajarilmadi. Qayta urinib ko‘ring.";
}

export default function GroupsResults({ userId, role }: { userId: string; role?: string }) {
  const queryClient = useQueryClient();
  const [archived, setArchived] = useState(false);
  const [groupSearch, setGroupSearch] = useState("");
  const listPrefix = ["groups", userId] as const;
  const listKey = [...listPrefix, archived, groupSearch] as const;
  const groups = useQuery({ queryKey: listKey, queryFn: ({ signal }) => get<GroupListItem[]>("/v1/groups", { archived, search: groupSearch }, { signal }) });
  const [selected, setSelected] = useState("");
  const groupId = groups.data?.find(group => group.id === selected)?.id ?? groups.data?.[0]?.id;
  const groupPath = `/v1/groups/${encodeURIComponent(groupId ?? "")}`;
  const detail = useQuery({
    queryKey: ["group-detail", userId, groupId],
    queryFn: ({ signal }) => get<GroupDetail>(groupPath, undefined, { signal }),
    enabled: Boolean(groupId),
  });
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [schedule, setSchedule] = useState<ScheduleItem[]>([{ day: "mon", startTime: "09:00", endTime: "11:00" }]);
  const [search, setSearch] = useState("");
  const [exportError, setExportError] = useState("");
  const [exporting, setExporting] = useState(false);

  const createGroup = useMutation({
    mutationFn: async (input: GroupInput) => {
      const group = await post<GroupDetail>("/v1/groups", input);
      if (typeof group?.id !== "string" || !group.id.trim() || typeof group.name !== "string") {
        throw new Error("Server guruhni tasdiqlamadi. Qayta urinishdan oldin ro‘yxatni yangilang.");
      }
      return group;
    },
    onSuccess: (group) => {
      if (!archived && !groupSearch) queryClient.setQueryData<GroupListItem[]>(listKey, current => [
        ...(current ?? []).filter(item => item.id !== group.id),
        { ...group, studentsCount: group.students.length },
      ]);
      queryClient.setQueryData(["group-detail", userId, group.id], group);
      setSelected(group.id);
      setCreating(false);
      setName("");
      setGroupSearch("");
      setArchived(false);
      void queryClient.invalidateQueries({ queryKey: listPrefix });
    },
  });

  const archive = useMutation({
    mutationFn: () => put<ClassroomArchiveState>(groupPath + "/archive", { archived: !archived }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: listPrefix }),
  });

  function submitGroup(event: FormEvent) {
    event.preventDefault();
    const trimmed = name.trim();
    if (trimmed.length >= 2 && !createGroup.isPending) createGroup.mutate({ name: trimmed, schedule });
  }

  async function exportReport(format: keyof typeof reportRoutes) {
    if (!groupId || exporting) return;
    setExporting(true);
    setExportError("");
    try {
      const { blob, filename } = await downloadBlob(`${groupPath}/${reportRoutes[format]}`);
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = filename || `group.${format}`;
      anchor.click();
      setTimeout(() => URL.revokeObjectURL(url), 0);
    } catch (error) {
      setExportError(errorMessage(error));
    } finally {
      setExporting(false);
    }
  }

  const group = detail.isError ? undefined : detail.data;
  const filter = search.trim().toLowerCase();
  const students = group?.students.filter(student =>
    student.name.toLowerCase().includes(filter) || (student.phone ?? "").includes(filter),
  );

  return (
    <section className="space-y-5">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold">Guruhlar va natijalar</h1>
        <button type="button" className="btn-brand px-4 py-2" onClick={() => setCreating(true)}>Yangi guruh yaratish</button>
      </header>

      {creating && (
        <form className="card space-y-4 rounded-2xl p-4" onSubmit={submitGroup}>
          <label className="grid gap-1">Guruh nomi
            <input className={inputStyle} value={name} onChange={event => setName(event.target.value)} minLength={2} maxLength={100} required />
          </label>
          <ClassroomSchedule slots={schedule} onChange={setSchedule} />
          {createGroup.isError && <p role="alert" className="text-red-300">{errorMessage(createGroup.error)}</p>}
          <div className="flex gap-3">
            <button className="btn-brand px-4 py-2 disabled:opacity-50" disabled={createGroup.isPending || name.trim().length < 2}>
              {createGroup.isPending ? "Saqlanmoqda…" : "Saqlash"}
            </button>
            <button type="button" disabled={createGroup.isPending} onClick={() => { setCreating(false); createGroup.reset(); }}>Bekor qilish</button>
          </div>
        </form>
      )}

      <div className="flex flex-wrap gap-3">
        <label className="flex items-center gap-2">Guruh qidirish
          <input className={inputStyle} type="search" maxLength={100} value={groupSearch} onChange={event => setGroupSearch(event.target.value)} />
        </label>
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={archived} onChange={event => setArchived(event.target.checked)} />Arxivlangan guruhlar
        </label>
      </div>
      {groups.isPending && <p role="status">Guruhlar yuklanmoqda…</p>}
      {groups.isError && <p role="alert">{errorMessage(groups.error)} <button type="button" onClick={() => void groups.refetch()}>Qayta urinish</button></p>}
      {groups.isSuccess && !groupId && <p>Guruhlar yo‘q.</p>}
      {!groups.isError && groupId && (
        <label className="flex items-center gap-3">Guruh
          <select className={inputStyle} value={groupId} onChange={event => { setSelected(event.target.value); setExportError(""); }}>
            {groups.data?.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
          </select>
        </label>
      )}
      {!groups.isError && groupId && detail.isPending && <p role="status">Natijalar yuklanmoqda…</p>}
      {!groups.isError && detail.isError && <p role="alert">{errorMessage(detail.error)} <button type="button" onClick={() => void detail.refetch()}>Qayta urinish</button></p>}

      {!groups.isError && group && (
        <div className="card space-y-4 rounded-2xl p-4">
          <header className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold">{group.name}</h2>
              <p className="text-sm">{group.teacherName ?? "O‘qituvchi biriktirilmagan"}</p>
              <p className="text-sm">{group.schedule?.map(slot => `${slot.day} ${slot.startTime}–${slot.endTime}`).join(", ") || "Jadval kiritilmagan"}</p>
            </div>
            <div className="flex gap-2">
              {(Object.keys(reportRoutes) as Array<keyof typeof reportRoutes>).map(format => (
                <button className={inputStyle} type="button" key={format} disabled={exporting} onClick={() => void exportReport(format)}>{format.toUpperCase()}</button>
              ))}
            </div>
          </header>
          <button className={inputStyle} type="button" disabled={archive.isPending} onClick={() => {
            if (window.confirm(archived ? "Guruhni tiklash?" : "Guruh arxivlansinmi? Tarix saqlanadi.")) archive.mutate();
          }}>{archived ? "Guruhni tiklash" : "Guruhni arxivlash"}</button>
          {archive.isError && <p role="alert">{errorMessage(archive.error)}</p>}
          {exportError && <p role="alert">{exportError}</p>}
          <dl className="flex flex-wrap gap-6 text-sm">
            <div><dt>O‘quvchilar</dt><dd>{group.students.length}</dd></div>
            <div><dt>Yakunlangan imtihonlar</dt><dd>{group.analytics.totalCompletedAttempts}</dd></div>
            <div><dt>O‘rtacha ball</dt><dd>{group.analytics.averageBandScore ?? "—"}</dd></div>
          </dl>
          <label className="grid max-w-sm gap-1">O‘quvchini qidirish
            <input className={inputStyle} value={search} onChange={event => setSearch(event.target.value)} />
          </label>
          {!students?.length ? <p>O‘quvchi topilmadi.</p> : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead><tr>{["O‘quvchi", "Imtihonlar", "Listening", "Reading", "Writing", "Speaking", "Umumiy"].map(label => <th className="p-2" key={label} scope="col">{label}</th>)}</tr></thead>
                <tbody>
                  {students.map(student => (
                    <tr className="border-t border-white/10" key={student.studentId}>
                      <th className="p-2 font-medium" scope="row">{student.name}{student.phone && <span className="block text-xs">{student.phone}</span>}</th>
                      {[student.completedExamsCount, student.listeningScore, student.readingScore, student.writingScore, student.speakingScore, student.overallBand].map((score, index) =>
                        <td className="p-2" key={index}>{score ?? "—"}</td>,
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
      {!groups.isError && group && !archived && <ClassroomWorkspace key={`workspace-${group.id}`} group={group} userId={userId} role={role} />}
      {!groups.isError && group && <ClassroomHistory key={`history-${group.id}`} groupId={group.id} userId={userId} />}
    </section>
  );
}
