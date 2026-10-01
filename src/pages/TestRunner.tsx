import { useMemo } from "react";
import ExamRunner from "@/components/exam-ui/ExamRunner";
import { legacyStartToParts } from "@/components/exam-ui/model";
import type { PassageMarks } from "@/components/exam-ui/PassagePane";
import { saveAnswer, saveMarks, submitAttempt, type StartResult, type TestListItem } from "@/lib/tests";

type Props = {
  test: TestListItem;
  start: StartResult;
  studentName: string | null;
  onExit: () => void;
  onFinish: (score: { autoScore: number | null }) => void;
};

/**
 * Legacy tests flow on the unified IELTS runner. Reading marks sync to the
 * server (passage-owner question id); everything else is identical.
 */
export default function TestRunner({ test, start, studentName, onExit, onFinish }: Props) {
  const parts = useMemo(() => legacyStartToParts(start), [start]);
  const partByKey = useMemo(() => new Map(parts.map((x) => [x.key, x])), [parts]);

  const deadlineIso = useMemo(() => {
    if (test.durationMinutes == null || test.durationMinutes <= 0) return null;
    return new Date(new Date(start.startedAt).getTime() + test.durationMinutes * 60_000).toISOString();
  }, [test.durationMinutes, start.startedAt]);

  return (
    <ExamRunner
      attemptId={start.attemptId}
      candidateName={studentName}
      sectionTitle={test.title}
      skill="test"
      timed={false}
      // Legacy start carries no server timestamp — fall back to the client
      // clock (offset 0). Mock flow passes real serverTime instead.
      serverTime={new Date().toISOString()}
      deadlineIso={deadlineIso}
      parts={parts}
      initialAnswers={start.savedAnswers ?? {}}
      storageKey={`examui.marks.tests.${start.attemptId}`}
      showVolume={parts.some((x) => x.audioUrl != null)}
      submitLabel={`Submit (${parts.reduce((s, x) => s + x.questions.length, 0)} Q)`}
      saveOne={(qid, value) => saveAnswer(start.attemptId, qid, value).then(() => undefined)}
      saveMany={(items) => {
        // Legacy tests API has no bulk endpoint — save sequentially.
        const run = async () => {
          for (const it of items) await saveAnswer(start.attemptId, it.questionId, it.response);
        };
        return run();
      }}
      submit={() =>
        submitAttempt(start.attemptId).then((res) => {
          onFinish({ autoScore: res?.autoScore ?? null });
        })
      }
      persistMarks={(partKey, marks: PassageMarks) => {
        const owner = partByKey.get(partKey)?.marksKey;
        if (!owner) return;
        void saveMarks(start.attemptId, owner, { highlights: marks.highlights, note: marks.note }).catch(
          () => undefined,
        );
      }}
      onExit={onExit}
    />
  );
}
