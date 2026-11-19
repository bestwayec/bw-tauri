import { useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ClassroomSchedule } from "../components/ClassroomSchedule";
import { UnifiedStudentProfileModal } from "../components/UnifiedStudentProfileModal";
import { del, downloadBlob, get, patch, post, put } from "../lib/api";
import type { ClassroomAssignment, ClassroomAssignmentInput, ClassroomBulkMembership, ClassroomVocabularyCollection, GroupDetail, ScheduleItem, VocabularyAssignmentReports } from "../lib/group-contract.generated";

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

export default function ClassroomWorkspace({ group, userId, role }: { group: GroupDetail; userId: string; role?: string }) {
  const queryClient = useQueryClient();
  const groupUrl = `/v1/groups/${encodeURIComponent(group.id)}`;
  const tasksKey = ["classroom-tasks", userId, group.id] as const;
  const marksKey = ["classroom-attendance", userId, group.id] as const;
  const [name, setName] = useState(group.name);
  const [schedule, setSchedule] = useState<ScheduleItem[]>(group.schedule ?? []);
  const [teacherId, setTeacherId] = useState(group.teacherId ?? "");
  const [selection, setSelection] = useState<string[]>([]);
  const isAdmin = role === "admin" || role === "super_admin";
  const teachers = useQuery({
    queryKey: ["classroom-teachers", userId],
    queryFn: () => get<Candidate[]>("/v1/users", { role: "teacher", limit: 100 }),
    enabled: isAdmin,
  });
  const [title, setTitle] = useState("");
  const [examId, setExamId] = useState("");
  const [vocabularySet, setVocabularySet] = useState("");
  const [deadline, setDeadline] = useState("");
  const [minimum, setMinimum] = useState("80");
  const [reportId, setReportId] = useState("");
  const [reportPage, setReportPage] = useState(1);
  const [reportSearch, setReportSearch] = useState("");

  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [date, setDate] = useState(todayInTashkent);
  const [studentId, setStudentId] = useState("");
  const [state, setState] = useState<AttendanceState>("present");
  const [removeId, setRemoveId] = useState("");
  const [viewStudentId, setViewStudentId] = useState<string | null>(null);

  const tasks = useQuery({ queryKey: tasksKey, queryFn: () => get<ClassroomAssignment[]>(groupUrl + "/assignments") });
  const collections = useQuery({
    queryKey: ["classroom-vocabulary-collections", userId, group.id],
    queryFn: () => get<ClassroomVocabularyCollection[]>(groupUrl + "/vocabulary-collections"),
  });
  const exams = useQuery({
    queryKey: ["classroom-assignable-exams", userId, group.id],
    queryFn: () => get<Array<{ id: string; title: string }>>(groupUrl + "/assignable-exams"),
  });
  const reportPath = groupUrl + "/assignments/" + encodeURIComponent(reportId) + "/vocabulary-results";
  const report = useQuery({
    queryKey: ["classroom-vocabulary-report", userId, group.id, reportId, reportPage, reportSearch],
    queryFn: () => get<VocabularyAssignmentReports>(reportPath, { page: reportPage, search: reportSearch }),
    enabled: Boolean(reportId),
  });
  const exportReport = useMutation({
    mutationFn: (format: "csv" | "xlsx") => downloadBlob(reportPath + "?download=" + format),
    onSuccess: ({ blob, filename }, format) => {
      const source = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = source;
      anchor.download = filename || `vocabulary-results.${format}`;
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
      queryClient.invalidateQueries({ queryKey: ["classroom-history", userId, group.id] }),
      queryClient.invalidateQueries({ queryKey: ["classroom-student-history", userId, group.id] }),
    ]);
  }
  const rename = useMutation({
    mutationFn: () => patch(groupUrl, {
      name: name.trim(), schedule, ...(isAdmin ? { teacherId: teacherId || null } : {}),
    }),
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
  const bulk = useMutation({
    mutationFn: (body: ClassroomBulkMembership) => post<{ updated: number }>(groupUrl + "/students/bulk", body),
    onSuccess: async () => { setSelection([]); await refreshRoster(); },
  });
  const createTask = useMutation({
    mutationFn: (input: ClassroomAssignmentInput) => post<ClassroomAssignment>(groupUrl + "/assignments", input),
    onSuccess: async () => {
      setTitle("");
      setVocabularySet("");
      setExamId("");
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
  const addIds = (matching ?? []).filter(item => selection.includes(item.id)).map(item => item.id);
  const removeIds = selection.filter(id => currentIds.has(id));
  function toggleMember(id: string, checked: boolean) {
    setSelection(previous => checked ? [...previous, id] : previous.filter(item => item !== id));
  }
  return (
    <section className="grid gap-4 lg:grid-cols-2" aria-label={`${group.name} guruh ish maydoni`}>
      <section className="card space-y-3 rounded-2xl p-4">
        <h2 className="text-lg font-semibold">Guruh tarkibi</h2>
        <form className="flex flex-wrap items-end gap-2" onSubmit={event => { event.preventDefault(); if (name.trim().length >= 2) rename.mutate(); }}>
          <label className="grid gap-1">Guruh nomini tahrirlash
            <input className={inputStyle} value={name} onChange={event => setName(event.target.value)} minLength={2} maxLength={100} required />
          </label>
          <div className="basis-full"><ClassroomSchedule slots={schedule} onChange={setSchedule} /></div>
          {isAdmin && <label className="grid gap-1">O‘qituvchi
            <select className={inputStyle} value={teacherId} onChange={event => setTeacherId(event.target.value)}>
              <option value="">Biriktirilmagan</option>
              {teachers.data?.map(teacher => <option key={teacher.id} value={teacher.id}>{teacher.name}</option>)}
            </select>
          </label>}
          <button className={inputStyle} disabled={rename.isPending || name.trim().length < 2}>Sozlamalarni saqlash</button>
        </form>
        {teachers.isError && <p role="alert">{errorMessage(teachers.error)}</p>}
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
          {matching.map(candidate => <li className="flex justify-between gap-2" key={candidate.id}><label className="flex items-center gap-2"><input type="checkbox" checked={selection.includes(candidate.id)} onChange={event => toggleMember(candidate.id, event.target.checked)} />{candidate.name}</label>
            <button className={inputStyle} type="button" disabled={membership.isPending} onClick={() => membership.mutate({ id: candidate.id, remove: false })}>Qo‘shish</button>
          </li>)}
        </ul>)}
        <ul className="space-y-2">
          {group.students.map(student => <li className="flex justify-between gap-2" key={student.studentId}>
            <div className="flex items-center gap-2">
              <input type="checkbox" checked={selection.includes(student.studentId)} onChange={event => toggleMember(student.studentId, event.target.checked)} />
              <button
                type="button"
                onClick={() => setViewStudentId(student.studentId)}
                className="text-left font-medium hover:text-emerald-400 hover:underline transition-colors"
                title="O‘quvchi to‘liq profilini ko‘rish"
              >
                {student.name}
              </button>
            </div>
            {removeId === student.studentId ? <span className="flex gap-2">
              <button className={inputStyle} type="button" disabled={membership.isPending} onClick={() => membership.mutate({ id: student.studentId, remove: true })}>Olib tashlashni tasdiqlash</button>
              <button type="button" onClick={() => setRemoveId("")}>Bekor qilish</button>
            </span> : <button className={inputStyle} type="button" onClick={() => setRemoveId(student.studentId)}>Olib tashlash</button>}
          </li>)}
        </ul>
        <div className="flex flex-wrap gap-2">
          <button type="button" className={inputStyle} disabled={!addIds.length || bulk.isPending || membership.isPending} onClick={() => bulk.mutate({ action: "add", studentIds: addIds })}>Tanlanganlarni qo‘shish</button>
          <button type="button" className={inputStyle} disabled={!removeIds.length || bulk.isPending || membership.isPending} onClick={() => {
            if (window.confirm("Tanlangan o‘quvchilar chiqarilsinmi? Tarix saqlanadi.")) bulk.mutate({ action: "remove", studentIds: removeIds });
          }}>Tanlanganlarni olib tashlash</button>
        </div>
        {bulk.isError && <p role="alert">{errorMessage(bulk.error)}</p>}
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
            ...(examId ? { exam_id: examId, min_pass_percent: Number(minimum) } : {}),
          });
        }}>
          <label className="grid gap-1">Vazifa nomi
            <input className={inputStyle} value={title} onChange={event => setTitle(event.target.value)} maxLength={255} required />
          </label>
          <label className="grid gap-1">Muddat (ixtiyoriy)
            <input className={inputStyle} type="datetime-local" value={deadline} onChange={event => setDeadline(event.target.value)} />
          </label>
          <label className="grid gap-1">Lug‘at to‘plami
            <select className={inputStyle} value={vocabularySet} onChange={event => { setVocabularySet(event.target.value); if (event.target.value) setExamId(""); }}>
              <option value="">To‘plam tanlanmagan</option>
              {collections.data?.map(set => <option key={set.id} value={set.id}>{set.title} ({set.wordCount})</option>)}
            </select>
          </label>
          <label className="grid gap-1">Nashr etilgan imtihon
            <select className={inputStyle} value={examId} onChange={event => { setExamId(event.target.value); if (event.target.value) setVocabularySet(""); }}>
              <option value="">Imtihon tanlanmagan</option>
              {exams.data?.map(exam => <option key={exam.id} value={exam.id}>{exam.title}</option>)}
            </select>
          </label>
          {(vocabularySet || examId) && <label className="grid gap-1">Minimal ball (%)
            <input className={inputStyle} type="number" min={0} max={100} value={minimum} required onChange={event => setMinimum(event.target.value)} />
          </label>}
          <button className={inputStyle} disabled={!title.trim() || createTask.isPending}>Vazifa berish</button>
        </form>
        {exams.isError && <p role="alert">{errorMessage(exams.error)} <button type="button" onClick={() => void exams.refetch()}>Qayta urinish</button></p>}
        {collections.isError && <p role="alert">{errorMessage(collections.error)} <button type="button" onClick={() => void collections.refetch()}>Qayta urinish</button></p>}
        {createTask.isError && <p role="alert">{errorMessage(createTask.error)}</p>}
        {tasks.isPending && <p role="status">Vazifalar yuklanmoqda…</p>}
        {tasks.isError && <p role="alert">{errorMessage(tasks.error)} <button type="button" onClick={() => void tasks.refetch()}>Qayta urinish</button></p>}
        {tasks.isSuccess && (tasks.data.length ? <ul>
          {tasks.data.map(task => <li className="flex flex-wrap items-center gap-2" key={task.id}>
            {task.title} · <time dateTime={task.deadline}>{new Date(task.deadline).toLocaleString()}</time>
            {task.vocabulary_set_id && <button className={inputStyle} type="button" aria-expanded={reportId === task.id} onClick={() => { setReportId(reportId === task.id ? "" : task.id); setReportPage(1); setReportSearch(""); }}>Lug‘at natijalari</button>}
          </li>)}
        </ul> : <p>Hozircha vazifalar yo‘q.</p>)}
        {reportId && report.isPending && <p role="status">Natijalar yuklanmoqda…</p>}
        {reportId && report.isError && <p role="alert">{errorMessage(report.error)} <button type="button" onClick={() => void report.refetch()}>Qayta urinish</button></p>}
        {reportId && report.data && !report.isError && <div className="space-y-2 rounded-lg border border-white/15 p-3">
          <p>{report.data.completedCount} / {report.data.assignedCount} o‘quvchi yakunladi</p>
          <p>{report.data.overdueCount} ta muddati o‘tgan</p>
          <button className={inputStyle} type="button" disabled={exportReport.isPending} onClick={() => exportReport.mutate("csv")}>CSV</button>
          <button className={inputStyle} type="button" disabled={exportReport.isPending} onClick={() => exportReport.mutate("xlsx")}>XLSX</button>
          {exportReport.isError && <p role="alert">{errorMessage(exportReport.error)}</p>}
          <label className="grid gap-1">Search results
            <input className={inputStyle} value={reportSearch} onChange={event => { setReportSearch(event.target.value); setReportPage(1); }} />
          </label>
          <ul>{report.data.students.map(student => <li key={student.studentId}>{student.name} · {student.percentage}%{!student.currentlyEnrolled && " · Former member"}</li>)}</ul>
          <div className="flex gap-2">
            <button className={inputStyle} type="button" disabled={reportPage === 1} onClick={() => setReportPage(reportPage - 1)}>Previous</button>
            <button className={inputStyle} type="button" disabled={!report.data.hasNext} onClick={() => setReportPage(reportPage + 1)}>Next</button>
          </div>
          {report.data.overdueStudents.length > 0 && <ul>{report.data.overdueStudents.map(student => <li key={student.studentId}>{student.name} · Overdue</li>)}</ul>}
          {report.data.missedWords.length > 0 && <div><h3>Ko‘p xato qilingan so‘zlar</h3>
            <ul>{report.data.missedWords.map(word => <li key={word.english}>{word.english} · {word.count}</li>)}</ul>
          </div>}
        </div>}
      </section>

      {viewStudentId && (
        <UnifiedStudentProfileModal
          groupId={group.id}
          studentId={viewStudentId}
          userId={userId}
          onClose={() => setViewStudentId(null)}
        />
      )}
    </section>
  );
}
