import { useMemo, useState } from "react";
import ExamRunner from "@/components/exam-ui/ExamRunner";
import { hasActiveRecording, hasPendingRecordings } from '@/lib/durable-recordings';
import { post } from '@/lib/api';
import { mockSectionToParts } from "@/components/exam-ui/model";
import {
  bulkMockAnswers,
  MOCK_SKILL_LABEL,
  saveMockAnswer,
  submitMockAttempt,
  uploadMockSpeaking,
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
  const parts = useMemo(() => mockSectionToParts(section, attemptId, timed).map((part) => ({ ...part, questions: part.questions.map((q) => ({ ...q, ...(q.guidance ? { recordingContext: { attemptId, timed, hasAudio: start.savedAnswers[q.id] === '[audio]' } } : {}) })) })), [section, attemptId, timed, start.savedAnswers]);

  const [uploadNotes, setUploadNotes] = useState<Record<string, string>>({});
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

  async function handleBlob(qid: string, blob: Blob) {
    setUploadNotes((n) => ({ ...n, [qid]: "Uploading…" }));
    try {
      await uploadMockSpeaking(attemptId, qid, blob);
      setAudioDoneMap((s) => ({ ...s, [qid]: true }));
      setUploadNotes((n) => ({ ...n, [qid]: "Uploaded ✓ — your teacher will grade it." }));
    } catch (e) {
      setUploadNotes((n) => ({
        ...n,
        [qid]: `Upload failed (${friendlyError(e)}). Re-record to retry.`,
      }));
    }
  }

  return (
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
        if (start.exam.specificationVersion && (hasActiveRecording(attemptId) || await hasPendingRecordings(attemptId))) throw new Error('Finish recording and upload saved takes before submitting.');
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
  );
}
