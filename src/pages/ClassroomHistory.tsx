import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { get } from "../lib/api";
import type { ClassroomHistoryPage, ClassroomStudentHistory } from "../lib/group-contract.generated";

export function ClassroomHistory({ groupId, userId }: { groupId: string; userId: string }) {
  const [page, setPage] = useState(1);
  const [student, setStudent] = useState("");
  const path = `/v1/groups/${encodeURIComponent(groupId)}/member-history`;
  const members = useQuery({
    queryKey: ["classroom-history", userId, groupId, page],
    queryFn: ({ signal }) => get<ClassroomHistoryPage>(path, { page }, { signal }),
  });
  const history = useQuery({
    queryKey: ["classroom-student-history", userId, groupId, student],
    queryFn: ({ signal }) => get<ClassroomStudentHistory>(`${path}/${encodeURIComponent(student)}`, undefined, { signal }),
    enabled: Boolean(student),
  });

  return (
    <section className="card space-y-3 rounded-2xl p-4">
      <h2 className="text-lg font-semibold">O‘quvchi tarixi</h2>
      {members.isError && <p role="alert">Tarix yuklanmadi. <button type="button" onClick={() => void members.refetch()}>Qayta urinish</button></p>}
      {members.isPending && <p role="status">Yuklanmoqda…</p>}
      {members.data && !members.isError && <div className="flex flex-wrap gap-2">
        {members.data.members.map(member => <button className="rounded border px-3 py-2" key={member.id} type="button" aria-pressed={student === member.id} onClick={() => setStudent(member.id)}>
          {member.name}{member.currentlyEnrolled ? "" : " · Sobiq a’zo"}
        </button>)}
        <button className="px-2" type="button" disabled={page === 1} onClick={() => setPage(page - 1)}>Oldingi</button>
        <button className="px-2" type="button" disabled={!members.data.hasNext} onClick={() => setPage(page + 1)}>Keyingi</button>
      </div>}
      {student && history.isPending && <p role="status">Yuklanmoqda…</p>}
      {history.isError && <p role="alert">Tarix yuklanmadi. <button type="button" onClick={() => void history.refetch()}>Qayta urinish</button></p>}
      {history.data && !history.isError && <div className="space-y-2 rounded-lg border border-white/15 p-3">
        <h3 className="font-semibold">{history.data.name}</h3>
        <ul>{history.data.membership.map((row, index) => <li key={index}>{row.startedAt?.slice(0, 10) ?? "Boshlanishi noma’lum"} – {row.endedAt?.slice(0, 10) ?? "Joriy a’zo"}</li>)}</ul>
        <h4>Davomat</h4>
        <ul>{history.data.attendance.map(mark => <li key={mark.date}>{mark.date} · {{ present: "Keldi", late: "Kechikdi", absent: "Kelmadi" }[mark.state]}</li>)}</ul>
        <h4>Uy vazifalari</h4>
        <ul>{history.data.homework.map(work => <li key={work.assignment_id}>{work.assignment__title} · {work.status === "graded" ? `${work.score_percent}%` : "Baholash kutilmoqda"}</li>)}</ul>
        <h4>Imtihonlar</h4>
        <ul>{history.data.tests.map(exam => <li key={exam.id}>{exam.test__title} · {exam.total_score ?? "—"}</li>)}
          {history.data.mockExams.map(exam => <li key={exam.id}>{exam.exam__title} · {exam.overall_band ?? exam.overall_score ?? "—"}</li>)}
        </ul>
        {history.data.feedback.length > 0 && <><h4>Tasdiqlangan izoh</h4><ul>
          {history.data.feedback.map((row, index) => <li key={index}>{row.skill} · {row.final_score ?? "—"}{typeof row.approved_feedback === "string" && ` · ${row.approved_feedback}`}</li>)}
        </ul></>}
      </div>}
    </section>
  );
}
