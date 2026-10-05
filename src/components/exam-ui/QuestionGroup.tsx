import { widgetFor } from "./model";
import type { UIQuestion, UIPart } from "./model";
import {
  CheckWidget,
  EssayWidget,
  MapDiagram,
  MatchingWidget,
  RadioWidget,
  ShortWidget,
  SpeakingWidget,
  TfngWidget,
  YnngWidget,
} from "./widgets";

export interface QuestionGroupProps {
  part: UIPart;
  answers: Record<string, string>;
  flags: Record<string, boolean>;
  uploadNotes?: Record<string, string>;
  fontSize: number;
  onAnswer: (qid: string, value: string, immediate?: boolean) => void;
  onToggleFlag: (qid: string) => void;
  onSpeakBlob?: (qid: string, blob: Blob) => void;
  /** Render only these questions (gapped docs render the rest inline). */
  only?: UIQuestion[];
}

function essayMin(prompt: string, instructions: string | null): number {
  return /task\s*2/i.test(`${prompt} ${instructions ?? ""}`) ? 250 : 150;
}

/**
 * One IELTS question group: "Questions X–Y" header, the group instructions
 * verbatim, then one widget per question with a flag toggle.
 */
export default function QuestionGroup(p: QuestionGroupProps) {
  const list = p.only ?? p.part.questions;
  if (list.length === 0) return null;
  const first = list[0].number;
  const last = list[list.length - 1].number;
  const showMap = list.some((q) => q.kind === "map_label") && p.part.imageUrl;

  // Absent configuration preserves legacy IELTS one-use interaction.
  const takenBy = new Map<string, string[]>();
  for (const q of list) {
    if (p.part.optionsReusable !== true && (q.kind === "matching" || q.kind === "matching_headings" || q.kind === "map_label")) {
      takenBy.set(
        q.id,
        p.part.questions
          .filter((o) => o.id !== q.id && (o.kind === q.kind || (o.kind === "map_label" && q.kind === "map_label")))
          .map((o) => p.answers[o.id] ?? "")
          .filter(Boolean),
      );
    }
  }

  return (
    <section aria-label={`Questions ${first} to ${last}`} className="exam-group">
      <header className="exam-group-head">
        <h3 className="exam-group-title">
          Questions {first}{first !== last ? `–${last}` : ""}
        </h3>
        {p.part.instructions && <p className="exam-group-instr">{p.part.instructions}</p>}
        {list.some((q) => q.kind === 'matching' || q.kind === 'matching_headings') && <p className="exam-group-instr">{p.part.optionsReusable === true ? 'Options may be used more than once.' : 'Use each option at most once.'}</p>}
      </header>

      {showMap && <MapDiagram imageUrl={p.part.imageUrl} />}

      <ol className="exam-qlist">
        {list.map((q) => {
          const flagged = p.flags[q.id] ?? false;
          const widget = widgetFor(q.kind, (q.options?.length ?? 0) > 0);
          const base = { q, value: p.answers[q.id] ?? "", fontSize: p.fontSize };
          return (
            <li key={q.id} id={`q-${q.number}`} className="exam-q scroll-mt-2">
              <div className="exam-q-head">
                <span className="exam-q-meta">
                  Q{q.number} · {q.kind === 'speaking' && q.guidance ? `${q.guidance.displayLabel ?? `Part ${q.guidance.taskKey}`} response` : `${q.points} pt${q.points === 1 ? '' : 's'}`}
                </span>
                <button
                  type="button"
                  onClick={() => p.onToggleFlag(q.id)}
                  aria-pressed={flagged}
                  title={flagged ? "Unflag" : "Flag for review"}
                  className={`exam-flag${flagged ? " exam-flag-on" : ""}`}
                >
                  {flagged ? "⚑ flagged" : "⚑ flag"}
                </button>
              </div>
              <p className="exam-q-prompt" style={{ fontSize: p.fontSize }}>
                {q.prompt}
              </p>
              <div className="exam-q-widget">
                {widget === "radio" && (
                  <RadioWidget {...base} onChange={(v, im) => p.onAnswer(q.id, v, im)} />
                )}
                {widget === "checkbox" && (
                  <CheckWidget {...base} onChange={(v, im) => p.onAnswer(q.id, v, im)} />
                )}
                {widget === "tfng" && (
                  <TfngWidget {...base} onChange={(v, im) => p.onAnswer(q.id, v, im)} />
                )}
                {widget === "ynng" && (
                  <YnngWidget {...base} onChange={(v, im) => p.onAnswer(q.id, v, im)} />
                )}
                {widget === "matching" && (
                  <MatchingWidget
                    {...base}
                    taken={takenBy.get(q.id) ?? []}
                    onChange={(v, im) => p.onAnswer(q.id, v, im)}
                  />
                )}
                {widget === "map" && (
                  <MatchingWidget
                    {...base}
                    taken={takenBy.get(q.id) ?? []}
                    onChange={(v, im) => p.onAnswer(q.id, v, im)}
                  />
                )}
                {(widget === "short" || widget === "inline") && (
                  <ShortWidget {...base} onChange={(v, im) => p.onAnswer(q.id, v, im)} />
                )}
                {widget === "essay" && (
                  <EssayWidget
                    {...base}
                    minWords={q.guidance?.wordMin ?? essayMin(q.prompt, p.part.instructions)}
                    onChange={(v, im) => p.onAnswer(q.id, v, im)}
                  />
                )}
                {widget === "speaking" && (
                  <SpeakingWidget
                    {...base}
                    onBlob={p.onSpeakBlob}
                    uploadNote={p.uploadNotes?.[q.id] ?? null}
                    onChange={(v, im) => p.onAnswer(q.id, v, im)}
                  />
                )}
              </div>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
