import { useEffect, useMemo, useRef, useState } from "react";
import ExamRunner from "@/components/exam-ui/ExamRunner";
import { hasActiveRecording, hasPendingRecordings, recordingKey, recoverRecording } from '@/lib/durable-recordings';
import { uploadRetainedMockRecording } from '@/lib/mock-recordings';
import { post } from '@/lib/api';
import { mockSectionToParts } from "@/components/exam-ui/model";
import {
  bulkMockAnswers,
  MOCK_SKILL_LABEL,
  saveMockAnswer,
  submitMockAttempt,
  type MockShapedSection,
  type MockStartResult,
  type MockSubmitResult,
} from "@/lib/mocks";

type Props = {
  start: MockStartResult;
  section: MockShapedSection;
  studentName: string | null;
  onExit: () => void;
  onBackToSections: () => void;
  onFinish: (result: MockSubmitResult) => void;
  onAdvance?: (next: MockStartResult) => void;
};

function friendlyError(e: unknown): string {
  if (typeof e === "object" && e !== null) {
    const { code, message } = e as { code?: unknown; message?: unknown };
    if (typeof message === "string" && message) {
      return typeof code === "string" && code ? `${message} (${code})` : message;
    }
  }
  if (e instanceof Error && e.message) return e.message;
  return "Request failed. Check connection.";
}

/** Mock (IELTS) section flow on the unified runner. */
export default function MockExam({ start, section, studentName, onExit, onBackToSections, onFinish, onAdvance }: Props) {
  const attemptId = start.attemptId;
  const skill = section.skill;
  const timed = start.mode === "timed";
  const parts = useMemo(() => mockSectionToParts(section, attemptId, timed).map((part) => ({ ...part, questions: part.questions.map((q) => ({ ...q, ...(q.kind === 'speaking' || q.guidance ? { recordingContext: { attemptId, timed, hasAudio: start.savedAnswers[q.id] === '[audio]', profileVersion: start.exam.speakingProfileVersion } } : {}) })) })), [section, attemptId, timed, start.savedAnswers, start.exam.speakingProfileVersion]);

  const [uploadNotes, setUploadNotes] = useState<Record<string, string>>({});
  const [pendingTakes, setPendingTakes] = useState<Record<string, Blob>>({});
  const uploading = useRef(new Set<string>());
  const [recoveryError, setRecoveryError] = useState<string | null>(null);
  const [audioDoneMap, setAudioDoneMap] = useState<Record<string, boolean>>(() => {
    const out: Record<string, boolean> = {};
    for (const [qid, v] of Object.entries(start.savedAnswers ?? {})) {
      if (v === "[audio]") out[qid] = true;
    }
    return out;
  });

  const initialAnswers = useMemo(() => {
    const out: Record<string, string> = {};
    for (const [qid, v] of Object.entries(start.savedAnswers ?? {})) {
      if (v !== "[audio]") out[qid] = v;
    }
    return out;
  }, [start.savedAnswers]);

  const deadlineIso = start.sectionDeadlines?.[skill] ?? start.overallDeadlineAt ?? start.deadlineAt ?? null;

  useEffect(() => {
    if (start.exam.specificationVersion || skill !== 'speaking') return;
    let alive = true;
    void Promise.all(section.groups.flatMap((group) => group.questions.map(async (question) => {
      const blob = await recoverRecording(recordingKey(attemptId, question.id));
      if (alive && blob) setPendingTakes((takes) => ({ ...takes, [question.id]: blob }));
    }))).catch(() => { if (alive) setRecoveryError('Local recording recovery is unavailable. Keep this page open if you have an unuploaded take.'); });
    return () => { alive = false; };
  }, [attemptId, section.groups, skill, start.exam.specificationVersion]);

  async function handleBlob(qid: string, blob: Blob) {
    if (uploading.current.has(qid)) return;
    uploading.current.add(qid);
    setPendingTakes((takes) => ({ ...takes, [qid]: blob }));
    setUploadNotes((n) => ({ ...n, [qid]: "Uploading…" }));
    try {
      await uploadRetainedMockRecording(attemptId, qid, blob, () => {
        setRecoveryError('Could not persist the recording locally. Keep this page open until upload succeeds.');
      });
      setPendingTakes((takes) => { const next = { ...takes }; delete next[qid]; return next; });
      setAudioDoneMap((s) => ({ ...s, [qid]: true }));
      setUploadNotes((n) => ({ ...n, [qid]: "Uploaded ✓ — saved for assessment and teacher review." }));
    } catch (e) {
      setUploadNotes((n) => ({
        ...n,
        [qid]: `Upload or local cleanup failed (${friendlyError(e)}). Your take is retained; retry the saved recording below.`,
      }));
    } finally { uploading.current.delete(qid); }
  }

  return (
    <>
    {recoveryError && <p role="alert" className="my-2 rounded-lg bg-amber-400/10 p-3 text-sm">{recoveryError}</p>}
    {Object.entries(pendingTakes).length > 0 && <section className="card my-2 rounded-xl p-3" aria-label="Saved recordings awaiting upload"><p className="text-sm">Saved recordings must finish uploading before submission.</p>{Object.entries(pendingTakes).map(([qid, blob]) => <button key={qid} type="button" disabled={uploading.current.has(qid)} className="btn-ghost mt-2 rounded-lg px-3 py-2 text-sm" onClick={() => void handleBlob(qid, blob)}>Retry saved recording · {section.groups.flatMap((group) => group.questions).find((question) => question.id === qid)?.number ?? qid}</button>)}</section>}
    <ExamRunner
      attemptId={attemptId}
      candidateName={studentName}
      sectionTitle={`${start.exam.title} — ${MOCK_SKILL_LABEL[skill]}`}
      skill={skill}
      timed={timed}
      serverTime={start.serverTime}
      deadlineIso={deadlineIso}
      parts={parts}
      initialAnswers={initialAnswers}
      initialAudioDone={audioDoneMap}
      storageKey={`examui.marks.mock.${attemptId}`}
      showVolume={skill === "listening"}
      submitLabel={`Submit ${MOCK_SKILL_LABEL[skill]}`}
      saveOne={(qid, value) => saveMockAnswer(attemptId, qid, value).then(() => undefined)}
      saveMany={(items) => bulkMockAnswers(attemptId, items).then(() => undefined)}
      submit={async () => {
        if ((start.exam.specificationVersion || skill === 'speaking') && (hasActiveRecording(attemptId) || await hasPendingRecordings(attemptId))) throw new Error('Finish recording and upload saved takes before submitting.');
        if (start.exam.specificationVersion && start.flowMode === 'full_test' && skill !== 'speaking') {
          const next = await post<{ currentSkill: MockShapedSection['skill']; serverTime: string; sectionDeadlines: MockStartResult['sectionDeadlines']; overallDeadlineAt: string | null }>(`/mock/attempts/${attemptId}/advance`, {});
          onAdvance?.({ ...start, ...next }); return;
        }
        onFinish(await submitMockAttempt(attemptId, start.exam.specificationVersion ? undefined : [skill]));
      }}
      onSpeakBlob={(qid, blob) => void handleBlob(qid, blob)}
      speakNote={(qid) => uploadNotes[qid] ?? null}
      onExit={onExit}
      onBack={onBackToSections}
    />
    </>
  );
}
