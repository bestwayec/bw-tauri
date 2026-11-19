import { useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { del, get, patch, post, put } from "../lib/api";
import type { ClassroomAssignment, GroupDetail } from "../lib/group-contract.generated";

const inputStyle = "rounded-lg border border-white/15 bg-surface px-3 py-2 text-sm";
type AttendanceState = "present" | "absent" | "late";
type Candidate = { id: string; name: string };

function errorMessage(error: unknown) {
  return typeof error === "object" && error && "message" in error ? String(error.message) : "So‘rov bajarilmadi.";
}

function todayInTashkent() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tashkent", year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts();
  return ["year", "month", "day"].map(type => parts.find(part => part.type === type)?.value).join("-");
}

export default function ClassroomWorkspace({ group, userId }: { group: GroupDetail; userId: string }) {
  const queryClient = useQueryClient();
  const groupUrl = `/v1/groups/${encodeURIComponent(group.id)}`;
  const tasksKey = ["classroom-tasks", userId, group.id] as const;
  const marksKey = ["classroom-attendance", userId, group.id] as const;
  const [name, setName] = useState(group.name);
  const [title, setTitle] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [date, setDate] = useState(todayInTashkent);
  const [studentId, setStudentId] = useState("");
  const [state, setState] = useState<AttendanceState>("present");
  const [removeId, setRemoveId] = useState("");

  const tasks = useQuery({ queryKey: tasksKey, queryFn: () => get<ClassroomAssignment[]>(groupUrl + "/assignments") });
  const candidates = useQuery({
    queryKey: ["classroom-candidates", userId, search],
    queryFn: () => get<Candidate[]>("/v1/users", { role: "student", search, limit: 10 }),
    enabled: search.length >= 2,
  });
  const marks = useQuery({
    queryKey: [...marksKey, date],
    queryFn: () => get<{ students: { studentId: string; studentName: string; state: AttendanceState }[] }>(
      `/v1/attendance/group-summary/${encodeURIComponent(group.id)}`, { date },
    ),
    enabled: Boolean(date),
  });

  async function refreshRoster() {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["group-detail", userId] }),
      queryClient.invalidateQueries({ queryKey: ["groups", userId] }),
      queryClient.invalidateQueries({ queryKey: marksKey }),
    ]);
  }
  const rename = useMutation({
    mutationFn: () => patch(groupUrl, { name: name.trim() }),
    onSuccess: refreshRoster,
  });
  const membership = useMutation({
    mutationFn: ({ id, remove }: { id: string; remove: boolean }) => remove
      ? del(`${groupUrl}/students/${encodeURIComponent(id)}`)
      : post(groupUrl + "/students", { studentId: id }),
    onSuccess: async () => {
      setRemoveId("");
      await refreshRoster();
    },
  });
  const createTask = useMutation({
    mutationFn: () => post<ClassroomAssignment>(groupUrl + "/assignments", { title: title.trim() }),
    onSuccess: async () => {
      setTitle("");
      await queryClient.invalidateQueries({ queryKey: tasksKey });
    },
  });
  const saveMark = useMutation({
    mutationFn: () => put("/v1/attendance/bulk", { groupId: group.id, date, records: [{ studentId, state }] }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: marksKey }),
  });

  function onSearch(event: FormEvent) {
    event.preventDefault();
    setSearch(searchInput.trim());
  }

  const currentIds = new Set(group.students.map(student => student.studentId));
  const matching = candidates.data?.filter(candidate => !currentIds.has(candidate.id));
  return (
    <section className="grid gap-4 lg:grid-cols-2" aria-label="Guruh ish maydoni">
      <section className="card space-y-3 rounded-2xl p-4">
        <h2 className="text-lg font-semibold">Guruh tarkibi</h2>
        <form className="flex flex-wrap items-end gap-2" onSubmit={event => { event.preventDefault(); if (name.trim().length >= 2) rename.mutate(); }}>
          <label className="grid gap-1">Guruh nomini tahrirlash
            <input className={inputStyle} value={name} onChange={event => setName(event.target.value)} minLength={2} maxLength={100} required />
          </label>
          <button className={inputStyle} disabled={rename.isPending || name.trim() === group.name}>Saqlash</button>
        </form>
        {rename.isError && <p role="alert">{errorMessage(rename.error)}</p>}
        <form className="flex flex-wrap items-end gap-2" onSubmit={onSearch}>
          <label className="grid gap-1">Qo‘shish uchun o‘quvchi qidiring
            <input className={inputStyle} value={searchInput} onChange={event => setSearchInput(event.target.value)} minLength={2} required />
          </label>
          <button className={inputStyle}>Qidirish</button>
        </form>
        {search && candidates.isPending && <p role="status">Qidirilmoqda…</p>}
        {candidates.isError && <p role="alert">{errorMessage(candidates.error)} <button type="button" onClick={() => void candidates.refetch()}>Qayta urinish</button></p>}
        {candidates.isSuccess && (!matching?.length ? <p>Mos o‘quvchi topilmadi.</p> : <ul className="space-y-2">
          {matching.map(candidate => <li className="flex justify-between gap-2" key={candidate.id}>{candidate.name}
            <button className={inputStyle} type="button" disabled={membership.isPending} onClick={() => membership.mutate({ id: candidate.id, remove: false })}>Qo‘shish</button>
          </li>)}
        </ul>)}
        <ul className="space-y-2">
          {group.students.map(student => <li className="flex justify-between gap-2" key={student.studentId}>
            {student.name}
            {removeId === student.studentId ? <span className="flex gap-2">
              <button className={inputStyle} type="button" disabled={membership.isPending} onClick={() => membership.mutate({ id: student.studentId, remove: true })}>Olib tashlashni tasdiqlash</button>
              <button type="button" onClick={() => setRemoveId("")}>Bekor qilish</button>
            </span> : <button className={inputStyle} type="button" onClick={() => setRemoveId(student.studentId)}>Olib tashlash</button>}
          </li>)}
        </ul>
        {membership.isError && <p role="alert">{errorMessage(membership.error)}</p>}
      </section>

      <section className="card space-y-3 rounded-2xl p-4">
        <h2 className="text-lg font-semibold">Davomat</h2>
        <form className="flex flex-wrap items-end gap-2" onSubmit={event => { event.preventDefault(); if (date && currentIds.has(studentId)) saveMark.mutate(); }}>
          <label className="grid gap-1">Sana (Toshkent)
            <input className={inputStyle} type="date" required value={date} onChange={event => setDate(event.target.value)} />
          </label>
          <label className="grid gap-1">O‘quvchi
            <select className={inputStyle} required value={studentId} onChange={event => setStudentId(event.target.value)}>
              <option value="">Tanlang</option>
              {group.students.map(student => <option key={student.studentId} value={student.studentId}>{student.name}</option>)}
            </select>
          </label>
          <label className="grid gap-1">Holat
            <select className={inputStyle} value={state} onChange={event => setState(event.target.value as AttendanceState)}>
              <option value="present">Keldi</option><option value="late">Kechikdi</option><option value="absent">Kelmadi</option>
            </select>
          </label>
          <button className={inputStyle} disabled={!currentIds.has(studentId) || saveMark.isPending}>Davomatni saqlash</button>
        </form>
        {saveMark.isError && <p role="alert">{errorMessage(saveMark.error)}</p>}
        {date && marks.isPending && <p role="status">Davomat yuklanmoqda…</p>}
        {marks.isError && <p role="alert">{errorMessage(marks.error)} <button type="button" onClick={() => void marks.refetch()}>Qayta urinish</button></p>}
        {date && marks.isSuccess && (marks.data.students.length ? <ul>
          {marks.data.students.map(row => <li key={row.studentId}>{row.studentName} · {{ present: "Keldi", late: "Kechikdi", absent: "Kelmadi" }[row.state]}</li>)}
        </ul> : <p>Bu sana uchun davomat belgilanmagan.</p>)}
      </section>

      <section className="card space-y-3 rounded-2xl p-4 lg:col-span-2">
        <h2 className="text-lg font-semibold">Guruh vazifalari</h2>
        <form className="flex flex-wrap items-end gap-2" onSubmit={event => { event.preventDefault(); if (title.trim()) createTask.mutate(); }}>
          <label className="grid gap-1">Vazifa nomi
            <input className={inputStyle} value={title} onChange={event => setTitle(event.target.value)} maxLength={255} required />
          </label>
          <button className={inputStyle} disabled={!title.trim() || createTask.isPending}>Vazifa berish</button>
        </form>
        {createTask.isError && <p role="alert">{errorMessage(createTask.error)}</p>}
        {tasks.isPending && <p role="status">Vazifalar yuklanmoqda…</p>}
        {tasks.isError && <p role="alert">{errorMessage(tasks.error)} <button type="button" onClick={() => void tasks.refetch()}>Qayta urinish</button></p>}
        {tasks.isSuccess && (tasks.data.length ? <ul>
          {tasks.data.map(task => <li key={task.id}>{task.title} · <time dateTime={task.deadline}>{new Date(task.deadline).toLocaleString()}</time></li>)}
        </ul> : <p>Hozircha vazifalar yo‘q.</p>)}
      </section>
    </section>
  );
}
