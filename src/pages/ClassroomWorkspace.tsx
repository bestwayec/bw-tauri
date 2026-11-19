import { useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { del, downloadBlob, get, patch, post, put } from "../lib/api";
import type { ClassroomAssignment, ClassroomAssignmentInput, ClassroomVocabularyCollection, GroupDetail, VocabularyAssignmentReports } from "../lib/group-contract.generated";

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
  const [vocabularySet, setVocabularySet] = useState("");
  const [deadline, setDeadline] = useState("");
  const [minimum, setMinimum] = useState("80");
  const [reportId, setReportId] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [date, setDate] = useState(todayInTashkent);
  const [studentId, setStudentId] = useState("");
  const [state, setState] = useState<AttendanceState>("present");
  const [removeId, setRemoveId] = useState("");

  const tasks = useQuery({ queryKey: tasksKey, queryFn: () => get<ClassroomAssignment[]>(groupUrl + "/assignments") });
  const collections = useQuery({
    queryKey: ["classroom-vocabulary-collections", userId, group.id],
    queryFn: () => get<ClassroomVocabularyCollection[]>(groupUrl + "/vocabulary-collections"),
  });
  const reportPath = groupUrl + "/assignments/" + encodeURIComponent(reportId) + "/vocabulary-results";
  const report = useQuery({
    queryKey: ["classroom-vocabulary-report", userId, group.id, reportId],
    queryFn: () => get<VocabularyAssignmentReports>(reportPath),
    enabled: Boolean(reportId),
  });
  const exportReport = useMutation({
    mutationFn: () => downloadBlob(reportPath + "?download=csv"),
    onSuccess: ({ blob, filename }) => {
      const source = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = source;
      anchor.download = filename || "vocabulary-results.csv";
      anchor.click();
      setTimeout(() => URL.revokeObjectURL(source), 0);
    },
  });
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
    mutationFn: (input: ClassroomAssignmentInput) => post<ClassroomAssignment>(groupUrl + "/assignments", input),
    onSuccess: async () => {
      setTitle("");
      setVocabularySet("");
      setDeadline("");
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
        <form className="flex flex-wrap items-end gap-2" onSubmit={event => {
          event.preventDefault();
          if (!title.trim() || createTask.isPending) return;
          createTask.mutate({
            title: title.trim(),
            ...(deadline ? { deadline: new Date(deadline).toISOString() } : {}),
            ...(vocabularySet ? { vocabulary_set_id: vocabularySet, min_pass_percent: Number(minimum) } : {}),
          });
        }}>
          <label className="grid gap-1">Vazifa nomi
            <input className={inputStyle} value={title} onChange={event => setTitle(event.target.value)} maxLength={255} required />
          </label>
          <label className="grid gap-1">Muddat (ixtiyoriy)
            <input className={inputStyle} type="datetime-local" value={deadline} onChange={event => setDeadline(event.target.value)} />
          </label>
          <label className="grid gap-1">Lug‘at to‘plami
            <select className={inputStyle} value={vocabularySet} onChange={event => setVocabularySet(event.target.value)}>
              <option value="">To‘plam tanlanmagan</option>
              {collections.data?.map(set => <option key={set.id} value={set.id}>{set.title} ({set.wordCount})</option>)}
            </select>
          </label>
          {vocabularySet && <label className="grid gap-1">Minimal ball (%)
            <input className={inputStyle} type="number" min={0} max={100} value={minimum} required onChange={event => setMinimum(event.target.value)} />
          </label>}
          <button className={inputStyle} disabled={!title.trim() || createTask.isPending}>Vazifa berish</button>
        </form>
        {collections.isError && <p role="alert">{errorMessage(collections.error)} <button type="button" onClick={() => void collections.refetch()}>Qayta urinish</button></p>}
        {createTask.isError && <p role="alert">{errorMessage(createTask.error)}</p>}
        {tasks.isPending && <p role="status">Vazifalar yuklanmoqda…</p>}
        {tasks.isError && <p role="alert">{errorMessage(tasks.error)} <button type="button" onClick={() => void tasks.refetch()}>Qayta urinish</button></p>}
        {tasks.isSuccess && (tasks.data.length ? <ul>
          {tasks.data.map(task => <li className="flex flex-wrap items-center gap-2" key={task.id}>
            {task.title} · <time dateTime={task.deadline}>{new Date(task.deadline).toLocaleString()}</time>
            {task.vocabulary_set_id && <button className={inputStyle} type="button" aria-expanded={reportId === task.id} onClick={() => setReportId(reportId === task.id ? "" : task.id)}>Lug‘at natijalari</button>}
          </li>)}
        </ul> : <p>Hozircha vazifalar yo‘q.</p>)}
        {reportId && report.isPending && <p role="status">Natijalar yuklanmoqda…</p>}
        {reportId && report.isError && <p role="alert">{errorMessage(report.error)} <button type="button" onClick={() => void report.refetch()}>Qayta urinish</button></p>}
        {reportId && report.data && !report.isError && <div className="space-y-2 rounded-lg border border-white/15 p-3">
          <p>{report.data.completedCount} / {report.data.assignedCount} o‘quvchi yakunladi</p>
          <p>{report.data.overdueCount} ta muddati o‘tgan</p>
          <button className={inputStyle} type="button" disabled={exportReport.isPending} onClick={() => exportReport.mutate()}>CSV</button>
          {exportReport.isError && <p role="alert">{errorMessage(exportReport.error)}</p>}
          <ul>{report.data.students.map(student => <li key={student.studentId}>{student.name} · {student.percentage}%</li>)}</ul>
          {report.data.missedWords.length > 0 && <div><h3>Ko‘p xato qilingan so‘zlar</h3>
            <ul>{report.data.missedWords.map(word => <li key={word.english}>{word.english} · {word.count}</li>)}</ul>
          </div>}
        </div>}
      </section>
    </section>
  );
}
