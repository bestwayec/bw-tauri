import { countWords } from "@/lib/exam-types";
import type { RunnerQuestion } from "@/lib/tests";

export interface WritingTaskItem {
  q: RunnerQuestion;
  num: number;
}

type Props = {
  items: WritingTaskItem[];
  answers: Record<string, string>;
  currentNum: number;
  fontSize: number;
  instructions: string | null;
  onJump: (num: number) => void;
};

function taskLabel(prompt: string, fallback: string): string {
  const m = prompt.match(/task\s*(\d)/i);
  if (m) return `Task ${m[1]}`;
  return fallback;
}

/** Target words: explicit "N words" in prompt wins, else Task 2 → 250, else 150. */
function targetWords(prompt: string, label: string): number {
  const m = prompt.match(/(\d{3,})\s*words/i);
  if (m) return parseInt(m[1], 10);
  return label === "Task 2" ? 250 : 150;
}

function timeHint(label: string, taskCount: number): string | null {
  if (taskCount !== 2) return null;
  return label === "Task 2" ? "≈ 40 min · worth double" : "≈ 20 min";
}

/**
 * Writing material pane: Task 1 / Task 2 switcher with per-task word counts.
 * The official flow lets candidates start with either task — tabs jump to it.
 * Editors live on the right; this pane is the task sheet.
 */
export default function WritingPane({ items, answers, currentNum, fontSize, instructions, onJump }: Props) {
  const currentOwner = items.find((it) => it.num === currentNum) ?? items[0];
  const totalWords = items.reduce((s, it) => s + countWords(answers[it.q.id] ?? ""), 0);

  return (
    <div>
      {instructions && (
        <div className="rounded-xl bg-[#19D36B]/[0.06] px-3.5 py-2.5 text-xs leading-relaxed text-emerald-100/90 ring-1 ring-[#19D36B]/20">
          <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-[#19D36B]/80">Instructions</p>
          <p className="mt-1 whitespace-pre-wrap">{instructions}</p>
        </div>
      )}

      <div className="mt-3 grid grid-cols-2 gap-1.5" role="tablist" aria-label="Writing tasks">
        {items.map((it, i) => {
          const label = taskLabel(it.q.prompt, `Task ${i + 1}`);
          const target = targetWords(it.q.prompt, label);
          const words = countWords(answers[it.q.id] ?? "");
          const active = currentOwner?.q.id === it.q.id;
          const met = words >= target;
          return (
            <button
              key={it.q.id}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => onJump(it.num)}
              title={`${label} · Q${it.num} · ${words}/${target} words`}
              className={`rounded-xl px-3 py-2.5 text-left ring-1 transition ${
                active
                  ? "bg-[#19D36B]/12 ring-[#19D36B]/50"
                  : "bg-black/30 ring-white/10 hover:ring-white/25"
              }`}
            >
              <span className={`text-xs font-black ${active ? "text-[#19D36B]" : "text-white/80"}`}>{label}</span>
              <span className="ml-2 font-mono text-[10px] tabular-nums text-white/40">Q{it.num}</span>
              <span className={`mt-1 block font-mono text-[11px] tabular-nums ${met ? "text-[#19D36B]" : "text-white/45"}`}>
                {words}/{target} words{met ? " ✓" : ""}
              </span>
              {timeHint(label, items.length) && (
                <span className="mt-0.5 block text-[10px] text-white/30">{timeHint(label, items.length)}</span>
              )}
            </button>
          );
        })}
      </div>

      {currentOwner && (
        <div className="mt-3 rounded-xl bg-black/30 px-3.5 py-3 ring-1 ring-white/10">
          <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-white/35">
            {taskLabel(currentOwner.q.prompt, "Task")} · Q{currentOwner.num} — full text
          </p>
          <p className="mt-1.5 whitespace-pre-wrap leading-relaxed text-white/80" style={{ fontSize }}>
            {currentOwner.q.prompt}
          </p>
        </div>
      )}

      <p className="mt-2 text-[11px] leading-relaxed text-white/30">
        {totalWords} words total · write full sentences, no bullet points. Task 2 counts double — answer both.
      </p>
    </div>
  );
}
