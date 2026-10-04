import { useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { getAssessment, assessmentStatus, ASSESSMENT_POLL_INTERVAL, shouldPollAssessment, type Assessment, type AssessmentResult } from '@/lib/assessment';
import { resolveMockMediaUrl } from '@/lib/mocks';
import { useBlobMedia } from '@/lib/media';

function List({ title, items }: { title: string; items: string[] }) {
  if (!items.length) return null;
  return <div className="mt-3"><h4 className="text-sm font-bold">{title}</h4><ul className="mt-1 list-disc space-y-1 pl-5 text-sm text-white/70">{items.map((item, i) => <li key={i}>{item}</li>)}</ul></div>;
}

function Recording({ source }: { source: string }) {
  const [requested, setRequested] = useState(false);
  const safeSource = resolveMockMediaUrl(source);
  const media = useBlobMedia(requested ? safeSource : null);
  return <div className="mt-3">
    {!requested && <button type="button" className="btn-ghost rounded-lg px-3 py-2 text-sm" onClick={() => setRequested(true)}>Load original audio</button>}
    {media.loading && <p role="status">Loading your recording…</p>}
    {media.error && <p role="alert">{media.error}</p>}
    {requested && !safeSource && <p role="alert">The original audio link is unavailable. Contact your teacher.</p>}
    {media.url && <audio controls src={media.url} className="w-full" aria-label="Original submitted recording" />}
  </div>;
}

export function RubricFeedback({ result, assessment }: { result: AssessmentResult; assessment: Assessment }) {
  return <div>
    {assessment.skill === 'speaking' && result.pronunciationEvidence === 'UNAVAILABLE' && <p className="mt-3 rounded-lg bg-amber-400/10 p-3 text-sm text-amber-200">Pronunciation evidence is unavailable. Transcript feedback cannot establish a reliable pronunciation band; your teacher can review the original audio.</p>}
    {result.parts.map((part) => {
      const specification = assessment.parts.find((item) => item.id === part.id);
      return <section key={part.id} className="mt-4 rounded-xl border border-white/10 p-4">
        <h3 className="font-bold">{specification?.task || `Part ${part.id}`}</h3>
        {assessment.program === 'MULTILEVEL' && <p className="mt-1 text-sm">Holistic raw score: {part.rawScore ?? 'Pending'}{specification ? ` / ${specification.max}` : ''}</p>}
        {Object.entries(part.criteria).length > 0 && <dl className="mt-2 space-y-2 text-sm">{Object.entries(part.criteria).map(([criterion, score]) => <div key={criterion}><dt className="font-semibold">{criterion.replace(/_/g, ' ')}: {score ?? 'Unavailable'}</dt><dd className="text-white/60">{part.evidence[criterion]}</dd></div>)}</dl>}
        <dl className="mt-3 space-y-2 text-sm">{([
          ['Task coverage', part.feedback.taskCoverage], ['Grammar', part.feedback.grammar], ['Vocabulary', part.feedback.vocabulary],
          ['Fluency and cohesion', part.feedback.fluencyCohesion], ['Idea development', part.feedback.ideaDevelopment],
          ['Register', part.feedback.register], ['Spelling and punctuation', part.feedback.spellingPunctuation],
          ['Position / conclusion', part.feedback.position], ['Argument balance', part.feedback.argumentBalance],
        ] as const).filter(([, value]) => value).map(([label, value]) => <div key={label}><dt className="font-semibold">{label}</dt><dd className="whitespace-pre-wrap text-white/60">{value}</dd></div>)}</dl>
        {(part.feedback.forCovered !== null || part.feedback.againstCovered !== null) && <p className="mt-3 text-sm">FOR / SUPPORTING: {part.feedback.forCovered === null ? 'Not assessed' : part.feedback.forCovered ? 'Covered' : 'Missing'} · AGAINST / OPPOSING: {part.feedback.againstCovered === null ? 'Not assessed' : part.feedback.againstCovered ? 'Covered' : 'Missing'}</p>}
        <List title="Strengths" items={part.feedback.strengths} /><List title="Priority weaknesses" items={part.feedback.issues} />
        <List title="Missed prompts" items={part.feedback.missedPrompts} /><List title="Useful phrases" items={part.feedback.usefulPhrases} />
      </section>;
    })}
    <List title="Overall strengths" items={result.overallStrengths} /><List title="Priority improvements" items={result.priorityImprovements} />
    {result.grammarCorrections.length > 0 && <section className="mt-4"><h3 className="font-bold">Grammar corrections</h3>{result.grammarCorrections.map((correction, i) => <div key={i} className="mt-2 rounded-lg bg-white/5 p-3 text-sm"><p>Original: {correction.original}</p><p className="text-brand">Suggestion: {correction.corrected}</p><p className="text-white/60">{correction.explanation}</p></div>)}</section>}
    {result.vocabularyUpgrades.length > 0 && <section className="mt-4"><h3 className="font-bold">Vocabulary alternatives</h3>{result.vocabularyUpgrades.map((upgrade, i) => <div key={i} className="mt-2 rounded-lg bg-white/5 p-3 text-sm"><p>{upgrade.original} → {upgrade.alternative}</p><p className="text-white/60">{upgrade.explanation}</p></div>)}</section>}
    {result.improvedExamples.length > 0 && <section className="mt-4"><h3 className="font-bold">IMPROVED EXAMPLE</h3><p className="text-xs text-white/50">Suggested examples are separate from your original submission.</p>{result.improvedExamples.map((example, i) => <div key={i} className="mt-2 rounded-lg bg-brand/5 p-3"><p className="text-xs font-bold">{assessment.parts.find((part) => part.id === example.partId)?.task || example.partId}</p><p className="mt-1 whitespace-pre-wrap text-sm">{example.text}</p></div>)}</section>}
    <List title="Recommended next practice" items={result.recommendedPractice} />
  </div>;
}

export function AssessmentCard({ assessment }: { assessment: Assessment }) {
  const result = assessment.approvedFeedback ?? assessment.evaluation?.result;
  const score = assessment.finalScore ?? assessment.aiScore;
  const confidence = assessment.confidence ?? result?.confidence;
  return <article className="mt-4 rounded-xl border border-white/10 p-4">
    <div className="flex flex-wrap items-start justify-between gap-3"><div><h2 className="text-lg font-bold">{assessment.skill === 'writing' ? 'Writing' : 'Speaking'} feedback</h2><p role="status" className="mt-1 text-sm text-brand">{assessmentStatus(assessment)}</p></div>
      {score !== null && <p className="text-right"><strong className="text-2xl">{score}{assessment.program === 'MULTILEVEL' ? '/75' : '/9'}</strong><span className="block text-xs text-white/50">{assessment.program === 'MULTILEVEL' ? `Estimated Multilevel ${assessment.skill === 'writing' ? 'Writing' : 'Speaking'} Score` : `Estimated IELTS ${assessment.skill === 'writing' ? 'Writing' : 'Speaking'} Band`}</span>{assessment.finalScore === null && <span className="block text-xs text-amber-200">Provisional · awaiting teacher confirmation</span>}</p>}
    </div>
    <p className="mt-2 text-xs text-white/50">AI estimates are unofficial practice feedback. Final score source: {assessment.finalScoreSource ?? 'Pending'}{confidence != null ? ` · AI confidence: ${Math.round(confidence * 100)}%` : ''}</p>
    {assessment.teacherScore !== null && assessment.aiScore !== null && <p className="mt-1 text-xs text-white/60">Original AI estimate: {assessment.aiScore} · Teacher score: {assessment.teacherScore}</p>}
    {!result && <p className="mt-3 text-sm text-white/60">Your submission is saved. Feedback will appear after assessment or teacher review.</p>}
    <section className="mt-4"><h3 className="font-bold">ORIGINAL</h3>{assessment.submissions.map((submission) => <div key={submission.questionId} className="mt-3 rounded-lg bg-white/5 p-3">
      <h4 className="text-sm font-bold">{submission.prompt}</h4>{submission.context && <p className="mt-1 whitespace-pre-wrap text-xs text-white/50">{submission.context}</p>}
      {submission.originalResponse && <><p className="mt-2 whitespace-pre-wrap text-sm">{submission.originalResponse}</p><p className="mt-1 text-xs text-white/40">{submission.wordCount} words</p></>}
      {submission.audioUrl && <Recording source={submission.audioUrl} />}
      {submission.transcript ? <div className="mt-3"><h4 className="text-xs font-bold uppercase text-white/60">Transcript</h4><p className="mt-1 whitespace-pre-wrap text-sm">{submission.transcript.text}</p>{submission.transcript.confidence !== null && <p className="mt-1 text-xs text-white/40">Transcription confidence: {Math.round(submission.transcript.confidence * 100)}%</p>}</div> : submission.audioUrl && <p className="mt-2 text-xs text-white/50">Transcript pending or unavailable. Original audio is retained for teacher review.</p>}
    </div>)}</section>
    {result && <section className="mt-4"><h3 className="font-bold">FEEDBACK {assessment.approvedFeedback ? '· teacher approved' : '· AI estimate'}</h3><RubricFeedback result={result} assessment={assessment} /></section>}
    <p className="mt-4 text-[11px] text-white/35">{assessment.rubricVersion} · {assessment.promptVersion} · Assessment version {assessment.version}</p>
  </article>;
}

export default function AssessmentFeedback({ attemptId }: { attemptId: string }) {
  const windowStart = useRef(Date.now());
  const successfulRequests = useRef(0);
  const query = useQuery({ queryKey: ['assessment', attemptId], queryFn: async () => {
    const data = await getAssessment(attemptId); successfulRequests.current += 1; return data;
  }, retry: false,
    refetchOnWindowFocus: false, refetchOnReconnect: false,
    refetchInterval: (state) => state.state.error ? false : shouldPollAssessment(state.state.data,
      Math.max(0, successfulRequests.current - 1), Date.now() - windowStart.current) ? ASSESSMENT_POLL_INTERVAL : false,
  });
  const refresh = () => { windowStart.current = Date.now(); successfulRequests.current = 0; void query.refetch(); };
  return <section className="card mt-4 rounded-2xl p-5" aria-label="Assessment feedback">
    <div className="flex items-center justify-between gap-3"><h2 className="font-bold">Assessment status and feedback</h2><button type="button" disabled={query.isFetching} className="btn-ghost rounded-lg px-3 py-2 text-xs" onClick={refresh}>Refresh</button></div>
    <p className="mt-1 text-xs text-white/50">Your original answers and recordings remain saved. Status updates every 15 seconds for up to 5 minutes; refresh later if assessment is still queued.</p>
    {query.isPending && <p role="status" className="mt-3">Loading assessment…</p>}
    {query.isError && <p role="alert" className="mt-3 text-sm text-amber-200">Could not load assessment. Your submitted answers remain saved. Use Refresh to try again.</p>}
    {query.data?.assessments.length === 0 && <p className="mt-3 text-sm text-white/60">Submitted. Assessment feedback is not available for this historical attempt.</p>}
    {query.data?.assessments.map((assessment) => <AssessmentCard key={assessment.id} assessment={assessment} />)}
  </section>;
}
