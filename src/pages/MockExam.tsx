import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import ExamRunner from "@/components/exam-ui/ExamRunner";
import IntegrityCheck from "@/components/exam/IntegrityCheck";
import { proctorSupported, type SecurityLogEntry } from "@/lib/proctoring";
import { cacheExamPayload, readCachedExam } from "@/lib/offline-exam";
import { hasActiveRecording, hasPendingRecordings, recordingKey, recoverRecording } from '@/lib/durable-recordings';
import { uploadRetainedMockRecording } from '@/lib/mock-recordings';
import { post } from '@/lib/api';
import { mockSectionToParts, type UIPart } from "@/components/exam-ui/model";
import {
  bulkMockAnswers,
  MOCK_SKILL_LABEL,
  saveMockAnswer,
  singleSectionOf,
  submitMockAttempt,
  submitSkillsFor,
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
  // Single-section practice: the server scoped this attempt to one skill, so
  // the runner only ever sees that section and submit never waits on the
  // sections the student did not choose (see submitSkillsFor).
  const singleSkill = singleSectionOf(start);
  const sectionTitle = start.attemptTypeLabel ?? `${start.exam.title} — ${MOCK_SKILL_LABEL[skill]}`;
  const scopedNotice =
    singleSkill && singleSkill !== skill
      ? `This attempt is scoped to ${MOCK_SKILL_LABEL[singleSkill]} only.`
      : null;
  const buildParts = useCallback(
    (source: MockShapedSection): UIPart[] =>
      mockSectionToParts(source, attemptId, timed).map((part) => ({
        ...part,
        questions: part.questions.map((q) => ({
          ...q,
          ...(q.kind === 'speaking' || q.guidance
            ? { recordingContext: { attemptId, timed, hasAudio: start.savedAnswers[q.id] === '[audio]', profileVersion: start.exam.speakingProfileVersion } }
            : {}),
        })),
      })),
    [attemptId, timed, start.savedAnswers, start.exam.speakingProfileVersion],
  );
  const parts = useMemo(() => buildParts(section), [buildParts, section]);
  const [cachedParts, setCachedParts] = useState<UIPart[] | null>(null);

  // Offline-first: the exam the student was given is cached locally the moment
  // the attempt opens, so a restart (or a network drop) never has to rebuild it
  // from the server. If the server hands us a section with nothing to answer,
  // the cached copy stands in instead of an empty exam.
  useEffect(() => {
    try {
      if (typeof document !== "undefined" && !document.fullscreenElement) {
        document.documentElement.requestFullscreen?.().catch(() => undefined);
      }
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    void cacheExamPayload(attemptId, { start, section }).catch(() => undefined);
  }, [attemptId, start, section]);
  useEffect(() => {
    if (parts.some((part) => part.questions.length > 0)) {
      setCachedParts(null);
      return;
    }
    let alive = true;
    void readCachedExam<{ section?: MockShapedSection }>(attemptId)
      .then((cached) => {
        if (!alive || !cached?.section) return;
        const rebuilt = buildParts(cached.section);
        if (rebuilt.some((part) => part.questions.length > 0)) setCachedParts(rebuilt);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [attemptId, parts, buildParts]);
  const effectiveParts = cachedParts ?? parts;

  // Pre-exam camera check. A missing or refused camera is never fatal: the
  // student continues without it and the attempt records focus/window events.
  const [integrity, setIntegrity] = useState<{ snapshot: string | null; skipped: boolean } | null>(
    () => (proctorSupported() ? null : { snapshot: null, skipped: true }),
  );
  const [securityEvent, setSecurityEvent] = useState<SecurityLogEntry | null>(null);

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

  if (!integrity) {
    return <IntegrityCheck attemptId={attemptId} onReady={setIntegrity} onCancel={onBackToSections} />;
  }

  return (
    <>
    {scopedNotice && <p role="status" className="my-2 rounded-lg bg-white/5 p-3 text-xs text-white/60">{scopedNotice}</p>}
    {recoveryError && <p role="alert" className="my-2 rounded-lg bg-amber-400/10 p-3 text-sm">{recoveryError}</p>}
    <p role="status" className="my-2 rounded-lg bg-white/5 p-2 text-[11px] text-white/50">
      Integrity monitoring is on — focus and window changes are logged, and a webcam snapshot is taken at random intervals.
      {securityEvent?.kind === "webcam_snapshot" ? ` Last check: ${new Date(securityEvent.at).toLocaleTimeString()}.` : ""}
      {integrity.skipped ? " Camera check skipped for this attempt." : ""}
    </p>
    {Object.entries(pendingTakes).length > 0 && <section className="card my-2 rounded-xl p-3" aria-label="Saved recordings awaiting upload"><p className="text-sm">Saved recordings must finish uploading before submission.</p>{Object.entries(pendingTakes).map(([qid, blob]) => <button key={qid} type="button" disabled={uploading.current.has(qid)} className="btn-ghost mt-2 rounded-lg px-3 py-2 text-sm" onClick={() => void handleBlob(qid, blob)}>Retry saved recording · {section.groups.flatMap((group) => group.questions).find((question) => question.id === qid)?.number ?? qid}</button>)}</section>}
    <ExamRunner
      attemptId={attemptId}
      candidateName={studentName}
      sectionTitle={sectionTitle}
      skill={skill}
      timed={timed}
      simulatorMode={start.simulatorMode ?? (start.exam.type === "multilevel" ? "dtm" : "cdi")}
      serverTime={start.serverTime}
      deadlineIso={deadlineIso}
      parts={effectiveParts}
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
        // Single-section attempts are already scoped server-side: submit the
        // attempt as it stands. Multi-section attempts still declare the
        // section being finished so grading stays section-only.
        const result = await submitMockAttempt(attemptId, submitSkillsFor(start, skill));
        onFinish(result);
      }}
      onSpeakBlob={(qid, blob) => void handleBlob(qid, blob)}
      speakNote={(qid) => uploadNotes[qid] ?? null}
      onSecurityEvent={setSecurityEvent}
      onExit={onExit}
      onBack={onBackToSections}
    />
    </>
  );
}
