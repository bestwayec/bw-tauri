import { useId } from "react";
import BlobImage from "@/components/exam/BlobImage";
import SpeakingPane from "@/components/exam/SpeakingPane";
import { MultilevelRecorder, type MediaPhase } from '@/components/exam/multilevel-media';
import { post } from '@/lib/api';
import { uploadMockSpeaking } from '@/lib/mocks';
import { recordingKey } from '@/lib/durable-recordings';
import { countWords } from "@/lib/exam-types";
import type { RunnerQuestion } from "@/lib/tests";
import type { UIQuestion } from "./model";

export interface WidgetProps {
  q: UIQuestion;
  value: string;
  onChange: (v: string, immediate?: boolean) => void;
  fontSize: number;
}

function Letters({ index }: { index: number }) {
  return <span className="exam-opt-letter">{String.fromCharCode(65 + index)}</span>;
}

/** Single-choice radio list (multiple_choice with options). */
export function RadioWidget({ q, value, onChange, fontSize }: WidgetProps) {
  const name = useId();
  return (
    <div role="radiogroup" aria-label={`Question ${q.number}`} className="exam-opts" style={{ fontSize }}>
      {(q.options ?? []).map((o, i) => (
        <label key={i} className={`exam-opt${value === o ? " exam-opt-on" : ""}`}>
          <input
            type="radio"
            name={name}
            checked={value === o}
            onChange={() => onChange(o, true)}
            className="exam-radio"
          />
          <Letters index={i} />
          <span>{o}</span>
        </label>
      ))}
    </div>
  );
}

/** Multi-select checkboxes (backend scores the exact set). */
export function CheckWidget({ q, value, onChange, fontSize }: WidgetProps) {
  const selected = value ? value.split(",").map((v) => v.trim()).filter(Boolean) : [];
  function toggle(opt: string) {
    const next = selected.includes(opt) ? selected.filter((v) => v !== opt) : [...selected, opt];
    next.sort((a, b) => (q.options ?? []).indexOf(a) - (q.options ?? []).indexOf(b));
    onChange(next.join(","), true);
  }
  return (
    <div className="exam-opts" style={{ fontSize }}>
      <p className="exam-chooseline" aria-live="polite">
        {selected.length} selected
      </p>
      {(q.options ?? []).map((o, i) => (
        <label key={i} className={`exam-opt${selected.includes(o) ? " exam-opt-on" : ""}`}>
          <input type="checkbox" checked={selected.includes(o)} onChange={() => toggle(o)} className="exam-check" />
          <Letters index={i} />
          <span>{o}</span>
        </label>
      ))}
    </div>
  );
}

function TriState({
  q,
  value,
  onChange,
  fontSize,
  choices,
}: WidgetProps & { choices: [string, string, string] }) {
  const name = useId();
  return (
    <div role="radiogroup" aria-label={`Question ${q.number}`} className="exam-tri" style={{ fontSize }}>
      {choices.map((c) => (
        <label key={c} className={`exam-tri-opt${value === c ? " exam-opt-on" : ""}`}>
          <input type="radio" name={name} checked={value === c} onChange={() => onChange(c, true)} className="exam-radio" />
          <span>{c}</span>
        </label>
      ))}
    </div>
  );
}

export function TfngWidget(p: WidgetProps) {
  return <TriState {...p} choices={["TRUE", "FALSE", "NOT GIVEN"]} />;
}

export function YnngWidget(p: WidgetProps) {
  return <TriState {...p} choices={["YES", "NO", "NOT GIVEN"]} />;
}

/** Matching dropdown; options taken by sibling questions are disabled. */
export function MatchingWidget({
  q,
  value,
  onChange,
  fontSize,
  taken,
}: WidgetProps & { taken: string[] }) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value, true)}
      aria-label={`Answer for question ${q.number}`}
      className="exam-select"
      style={{ fontSize }}
    >
      <option value="">— Choose —</option>
      {(q.options ?? []).map((o, i) => (
        <option key={i} value={o} disabled={taken.includes(o) && value !== o}>
          {String.fromCharCode(65 + i)}. {o}
        </option>
      ))}
    </select>
  );
}

/** Short completion input with live word-limit hint. */
export function ShortWidget({ q, value, onChange, fontSize }: WidgetProps) {
  const words = countWords(value);
  const over = q.wordLimit != null && words > q.wordLimit;
  return (
    <div>
      {q.wordLimit != null && (
        <p className={`exam-limit${over ? " exam-limit-over" : ""}`}>
          No more than {q.wordLimit} word{q.wordLimit === 1 ? "" : "s"}
          {words > 0 ? ` — ${words}/${q.wordLimit}` : ""}
          {over ? " — too many" : ""}
        </p>
      )}
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        autoComplete="off"
        spellCheck={false}
        aria-label={`Answer for question ${q.number}`}
        aria-invalid={over || undefined}
        className={`exam-input${over ? " exam-input-over" : ""}`}
        style={{ fontSize }}
      />
    </div>
  );
}

/** Essay editor with live word count and minimum hint. */
export function EssayWidget({
  q,
  value,
  onChange,
  fontSize,
  minWords,
}: WidgetProps & { minWords: number | null }) {
  const words = countWords(value);
  const low = minWords != null && words < minWords;
  return (
    <div>
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        rows={10}
        spellCheck={false}
        autoCorrect="off"
        autoCapitalize="off"
        aria-label={`Answer for question ${q.number}`}
        className="exam-essay"
        style={{ fontSize }}
      />
      <p className={`exam-count${low ? " exam-count-low" : ""}`}>
        {words} words{q.guidance?.wordMax ? ` / guidance ${minWords}–${q.guidance.wordMax}` : minWords != null ? ` / ${minWords}+ needed` : ''}
      </p>
    </div>
  );
}

export interface SpeakingWidgetProps extends WidgetProps {
  onBlob?: (qid: string, blob: Blob) => void;
  uploadNote?: string | null;
}

/** Speaking keeps the existing recorder flow (timers + upload). */
export function SpeakingWidget({ q, value, onChange, fontSize, onBlob, uploadNote }: SpeakingWidgetProps) {
  const wq: RunnerQuestion = {
    id: q.id,
    section: "speaking",
    type: "speaking_prompt",
    prompt: q.prompt,
    options: null,
    maxScore: q.points,
  };
  return (
    <div>
      {q.guidance && <div className="mb-2 text-sm"><p>Part {q.guidance.taskKey} · holistic score /{q.guidance.rawMax ?? q.points} across this part’s responses.</p><p>Preparation: {q.guidance.prepSeconds ?? '—'} seconds · response: {q.guidance.responseSeconds ?? '—'} seconds</p>{(q.guidance.speakingProfileVersion ?? q.recordingContext?.profileVersion) && <p className="text-xs opacity-60">{q.guidance.profileLabel ?? q.guidance.speakingProfileVersion ?? q.recordingContext?.profileVersion} · BestWay product timing, not an exact official timing rule.</p>}</div>}
      {q.guidance && q.recordingContext ? <MultilevelRecorder
        attemptId={q.recordingContext.attemptId} questionId={q.id} timed={q.recordingContext.timed} initialHasAudio={q.recordingContext.hasAudio}
        startPhase={() => post<MediaPhase>(`/mock/attempts/${q.recordingContext!.attemptId}/speaking/${q.id}/start`, {})}
        upload={(blob) => uploadMockSpeaking(q.recordingContext!.attemptId, q.id, blob)}
      /> : <SpeakingPane
        q={wq}
        num={q.number}
        fontSize={fontSize}
        onBlob={onBlob ? (blob) => onBlob(q.id, blob) : undefined}
        uploadNote={uploadNote}
        recordingKey={q.recordingContext ? recordingKey(q.recordingContext.attemptId, q.id) : undefined}
      />}
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        rows={3}
        placeholder="Notes (optional — teachers grade the recording)…"
        aria-label={`Notes for question ${q.number}`}
        className="exam-notearea"
        style={{ fontSize }}
      />
    </div>
  );
}

/** Map labelling diagram (rendered once per group by QuestionGroup). */
export function MapDiagram({ imageUrl }: { imageUrl: string | null }) {
  if (!imageUrl) return null;
  return (
    <div className="exam-mapimg">
      <BlobImage src={imageUrl} alt="Labelled diagram" className="exam-mapimg-el" />
    </div>
  );
}
