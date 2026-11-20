import { useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { get, patch, post } from "../lib/api";
import { getAppLanguage } from "../lib/ui-prefs";
import type {
  ClassroomAssignment, ClassroomAssignmentInput, GroupListItem,
  VocabularyAssignmentReports, VocabularyCollection, VocabularyCollectionWordInput,
} from "../lib/group-contract.generated";

const control = "rounded-lg border border-white/15 bg-surface px-3 py-2 text-sm focus-visible:outline-2 focus-visible:outline-emerald-300 disabled:opacity-50";
const levels = ["A1", "A2", "B1", "B2", "C1", "C2", "IELTS", "MULTILEVEL"];
type Summary = { id: string; title: string; wordCount: number };

function message(error: unknown) {
  return typeof error === "object" && error && "message" in error ? String(error.message) : "Request failed.";
}

function CollectionForm({ collection, onSaved, onCancel }: {
  collection?: VocabularyCollection;
  onSaved: (id: string) => void;
  onCancel: () => void;
}) {
  const [title, setTitle] = useState(collection?.title ?? "");
  const [description, setDescription] = useState(collection?.description ?? "");
  const [level, setLevel] = useState(collection?.level ?? "B1");
  const [isPublic, setPublic] = useState(collection?.isPublic ?? false);
  const [words, setWords] = useState<VocabularyCollectionWordInput[]>(collection?.words ?? []);
  const [paste, setPaste] = useState("");
  const [preview, setPreview] = useState(false);
  const [index, setIndex] = useState<number | null>(null);

  const parsed = useMutation({
    mutationFn: () => post<{ words: Array<{ english: string; uzbek: string; context_sentence?: string; part_of_speech?: string }> }>(
      "/v1/vocabulary/sets/parse-text", { rawText: paste },
    ),
  });
  const save = useMutation({
    mutationFn: async () => {
      const body = { title, description, level, isPublic, words: words.map(word => ({
        ...word, synonyms: word.synonyms?.map(value => value.trim()).filter(Boolean),
      })) };
      return collection
        ? patch<VocabularyCollection>(`/v1/vocabulary/sets/${encodeURIComponent(collection.id)}`, { ...body, revision: collection.revision })
        : post<Summary>("/v1/vocabulary/sets", body);
    },
    onSuccess: result => onSaved(result.id),
  });
  const current = index === null ? undefined : words[index];
  function editWord(update: Partial<VocabularyCollectionWordInput>) {
    setWords(previous => previous.map((word, i) => i === index ? { ...word, ...update } : word));
    setPreview(false);
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    if (save.isPending || !title.trim() || !words.length) return;
    if (!preview) setPreview(true);
    else save.mutate();
  }

  return (
    <form className="card space-y-4 rounded-2xl p-4" onSubmit={submit}>
      <h2 className="text-lg font-semibold">{collection ? "Edit collection" : "New collection"}</h2>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="grid gap-1">Collection title<input required maxLength={255} className={control} value={title} onChange={event => { setTitle(event.target.value); setPreview(false); }} /></label>
        <label className="grid gap-1">Description<input maxLength={4000} className={control} value={description} onChange={event => { setDescription(event.target.value); setPreview(false); }} /></label>
        <label className="grid gap-1">Collection level
          <select className={control} value={level} onChange={event => { setLevel(event.target.value); setPreview(false); }}>
            {levels.map(value => <option key={value}>{value}</option>)}
          </select>
        </label>
        <label className="flex items-center gap-2"><input type="checkbox" checked={isPublic} onChange={event => { setPublic(event.target.checked); setPreview(false); }} />Visible in classroom catalog</label>
      </div>

      <div className="space-y-2">
        <label className="grid gap-1">Paste words
          <textarea className={control} rows={4} value={paste} placeholder="apple - olma" onChange={event => { setPaste(event.target.value); parsed.reset(); }} />
        </label>
        <button className={control} type="button" disabled={!paste.trim() || parsed.isPending} onClick={() => parsed.mutate()}>Preview pasted words</button>
        {parsed.isError && <p role="alert">{message(parsed.error)}</p>}
        {parsed.data && <div className="space-y-2">
          <ul className="max-h-36 overflow-y-auto">{parsed.data.words.map((word, i) => <li key={i}>{word.english} — {word.uzbek}</li>)}</ul>
          <button type="button" className={control} disabled={!parsed.data.words.length || words.length + parsed.data.words.length > 500} onClick={() => {
            setWords(previous => [...previous, ...(parsed.data?.words ?? []).map(word => ({
              english: word.english, uzbek: word.uzbek,
              contextSentence: word.context_sentence, partOfSpeech: word.part_of_speech,
            }))]);
            setPaste(""); parsed.reset(); setPreview(false);
          }}>Add {parsed.data.words.length} words</button>
        </div>}
      </div>

      <div className="space-y-2">
        <button className={control} type="button" disabled={words.length >= 500} onClick={() => {
          setIndex(words.length); setWords(previous => [...previous, { english: "", uzbek: "" }]); setPreview(false);
        }}>Add word</button>
        <ul className="max-h-72 divide-y divide-white/10 overflow-y-auto">
          {words.map((word, i) => <li className="flex flex-wrap justify-between gap-2 py-2" key={word.id ?? i}>
            <span>{word.english || "New word"} — {word.uzbek || "Translation required"}</span>
            <div className="flex gap-2">
              <button className={control} type="button" onClick={() => setIndex(index === i ? null : i)} aria-expanded={index === i}>Edit word</button>
              <button className={control} type="button" onClick={() => {
                setWords(previous => previous.filter((_, item) => item !== i)); setIndex(null); setPreview(false);
              }}>Remove word</button>
            </div>
          </li>)}
        </ul>
        {current && <fieldset className="grid gap-2 rounded-lg border border-white/15 p-3 sm:grid-cols-2">
          <legend>Edit selected word</legend>
          {([
            ["english", "English"], ["uzbek", "Uzbek"], ["definition", "Definition"], ["contextSentence", "Example sentence"],
            ["partOfSpeech", "Part of speech"], ["pronunciation", "Pronunciation"], ["audioUrl", "Audio URL (HTTPS)"],
          ] as const).map(([key, label]) => <label className="grid gap-1" key={key}>{label}
            <input className={control} value={current[key] ?? ""} onChange={event => editWord({ [key]: event.target.value })} />
          </label>)}
          <label className="grid gap-1">Synonyms (comma-separated)
            <input className={control} value={(current.synonyms ?? []).join(",")} onChange={event => editWord({ synonyms: event.target.value.split(",") })} />
          </label>
          <label className="grid gap-1">Word level
            <select className={control} value={current.level ?? ""} onChange={event => editWord({ level: event.target.value })}>
              <option value="">Use collection level</option>{levels.map(value => <option key={value}>{value}</option>)}
            </select>
          </label>
        </fieldset>}
      </div>

      {preview && <p role="status">Review the {words.length} words above before saving.</p>}
      {save.isError && <p role="alert">{message(save.error)}</p>}
      <div className="flex flex-wrap gap-2">
        <button className="btn-brand px-4 py-2 disabled:opacity-50" disabled={save.isPending || !title.trim() || !words.length || words.some(word => !word.english.trim() || !word.uzbek.trim())}>
          {save.isPending ? "Saving…" : !preview ? "Preview collection" : collection ? "Save changes" : "Publish collection"}
        </button>
        <button className={control} type="button" disabled={save.isPending} onClick={onCancel}>Cancel</button>
      </div>
    </form>
  );
}

function CollectionAssignments({ collection, userId }: { collection: Summary; userId: string }) {
  const client = useQueryClient();
  const [groupId, setGroupId] = useState("");
  const [deadline, setDeadline] = useState("");
  const [minimum, setMinimum] = useState("80");
  const [reportId, setReportId] = useState("");
  const [reportPage, setReportPage] = useState(1);
  const [reportSearch, setReportSearch] = useState("");

  const groupPath = `/v1/groups/${encodeURIComponent(groupId)}`;
  const key = ["studio-assignments", userId, groupId] as const;
  const groups = useQuery({ queryKey: ["groups", userId], queryFn: () => get<GroupListItem[]>("/v1/groups") });
  const assignments = useQuery({
    queryKey: key,
    queryFn: () => get<ClassroomAssignment[]>(groupPath + "/assignments"),
    enabled: Boolean(groupId),
  });
  const report = useQuery({
    queryKey: ["studio-results", userId, groupId, reportId, reportPage, reportSearch],
    queryFn: () => get<VocabularyAssignmentReports>(groupPath + "/assignments/" + encodeURIComponent(reportId) + "/vocabulary-results", { page: reportPage, search: reportSearch }),
    enabled: Boolean(groupId && reportId),
  });
  const assign = useMutation({
    mutationFn: (body: ClassroomAssignmentInput) => post<ClassroomAssignment>(groupPath + "/assignments", body),
    onSuccess: async assignment => {
      setReportId(assignment.id);
      await Promise.all([client.invalidateQueries({ queryKey: key }), client.invalidateQueries({ queryKey: ["classroom-tasks", userId, groupId] })]);
    },
  });
  const error = groups.error ?? assign.error ?? assignments.error ?? report.error;
  return (
    <section className="card space-y-3 rounded-2xl p-4">
      <h2 className="font-semibold">Assign {collection.title}</h2>
      <form className="flex flex-wrap items-end gap-2" onSubmit={event => {
        event.preventDefault();
        if (!groupId || assign.isPending) return;
        assign.mutate({ title: collection.title, vocabulary_set_id: collection.id, min_pass_percent: Number(minimum),
          ...(deadline ? { deadline: new Date(deadline).toISOString() } : {}) });
      }}>
        <label className="grid gap-1">Classroom
          <select required className={control} value={groupId} onChange={event => { setGroupId(event.target.value); setReportId(""); }}>
            <option value="">Select a classroom</option>
            {groups.data?.map(group => <option key={group.id} value={group.id}>{group.name}</option>)}
          </select>
        </label>
        <label className="grid gap-1">Deadline<input className={control} type="datetime-local" value={deadline} onChange={event => setDeadline(event.target.value)} /></label>
        <label className="grid gap-1">Passing score<input required className={control} type="number" min={0} max={100} value={minimum} onChange={event => setMinimum(event.target.value)} /></label>
        <button className={control} disabled={!groupId || assign.isPending}>Assign collection</button>
      </form>
      {error && <p role="alert">{message(error)}</p>}
      <ul>{assignments.data?.filter(task => task.vocabulary_set_id === collection.id).map(task => (
        <li key={task.id} className="flex flex-wrap items-center gap-2 py-1">{task.title} · {new Date(task.deadline).toLocaleString()}
          <button className={control} onClick={() => { setReportId(task.id); setReportPage(1); setReportSearch(""); }}>View completion report</button>
        </li>
      ))}</ul>
      {report.data && !report.isError && <div className="space-y-2">
        <p>{report.data.completedCount} / {report.data.assignedCount} completed · {report.data.overdueCount} overdue</p>
        <label className="grid gap-1">Search results
            <input className={control} value={reportSearch} onChange={event => { setReportSearch(event.target.value); setReportPage(1); }} />
          </label>
          <ul>{report.data.students.map(student => <li key={student.studentId}>{student.name} · {student.percentage}%{!student.currentlyEnrolled && " · Former member"}</li>)}</ul>
          <div className="flex gap-2">
            <button className={control} type="button" disabled={reportPage === 1} onClick={() => setReportPage(reportPage - 1)}>Previous</button>
            <button className={control} type="button" disabled={!report.data.hasNext} onClick={() => setReportPage(reportPage + 1)}>Next</button>
          </div>
          {report.data.overdueStudents.length > 0 && <ul>{report.data.overdueStudents.map(student => <li key={student.studentId}>{student.name} · Overdue</li>)}</ul>}
        <h3>Difficult words</h3>
        <ul>{report.data.missedWords.map(word => <li key={word.english}>{word.english} · {word.count}</li>)}</ul>
      </div>}
    </section>
  );
}

export default function VocabularyStudio({ userId }: { userId: string }) {
  const english = getAppLanguage() === "en";
  const [search, setSearch] = useState("");
  const client = useQueryClient();
  const key = ["studio-collections", userId] as const;
  const collections = useQuery({ queryKey: key, queryFn: () => get<Summary[]>("/v1/vocabulary/sets", { owned: true }) });
  const [editId, setEditId] = useState<string | null>(null);
  const [assignment, setAssignment] = useState<Summary>();
  const editable = useQuery({
    queryKey: ["studio-collection", userId, editId],
    queryFn: () => get<VocabularyCollection>(`/v1/vocabulary/sets/${encodeURIComponent(editId ?? "")}`),
    enabled: Boolean(editId),
  });
  const close = () => setEditId(null);
  function saved(id: string) {
    close();
    void Promise.all([client.invalidateQueries({ queryKey: key }), client.invalidateQueries({ queryKey: ["studio-collection", userId, id] })]);
  }

  return (
    <section className="space-y-4">
      <h1 className="text-2xl font-bold">Vocabulary studio</h1>
      <div className="flex flex-wrap items-end gap-3">
        <label className="grid grow gap-1 text-sm">
          {english ? "Search collections" : "To‘plamlarni qidirish"}
          <input type="search" className="workspace-control w-full" value={search} onChange={(event) => setSearch(event.target.value)} />
        </label>
        <button className="workspace-control btn-brand" type="button" onClick={() => setEditId("")}>New collection</button>
      </div>
      {collections.isError && <p role="alert">{message(collections.error)} <button className={control} onClick={() => void collections.refetch()}>Retry</button></p>}
      {collections.isPending && <p role="status">Loading collections…</p>}
      <ul className="space-y-2">{collections.data?.filter((collection) => collection.title.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase())).map(collection => <li className="workspace-panel flex flex-wrap items-center gap-3 p-3" key={collection.id}>
        <span className="grow">{collection.title} · {collection.wordCount} words</span>
        <button className={control} type="button" onClick={() => setEditId(collection.id)}>Edit collection</button>
        <button className={control} type="button" onClick={() => setAssignment(collection)}>Assignments</button>
      </li>)}</ul>
      {editId && editable.isPending && <p role="status">Loading collection…</p>}
      {editId && editable.isError && <p role="alert">{message(editable.error)} <button className={control} onClick={() => void editable.refetch()}>Retry</button></p>}
      {editId !== null && (!editId || (editable.data && !editable.isError)) &&
        <CollectionForm key={editId} collection={editId ? editable.data : undefined} onSaved={saved} onCancel={close} />}
      {assignment && <CollectionAssignments key={assignment.id} collection={assignment} userId={userId} />}
    </section>
  );
}
