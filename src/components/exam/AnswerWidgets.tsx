import { countWords, normalizeKind, wordLimitFor, wordLimitHint, type ExamKind } from "@/lib/exam-types";
import type { RunnerQuestion } from "@/lib/tests";

type Props = {
  q: RunnerQuestion;
  value: string;
  onChange: (value: string) => void;
  fontSize: number;
};

function OptionButtons({
  options,
  value,
  onChange,
  compact,
}: {
  options: string[];
  value: string;
  onChange: (v: string) => void;
  compact?: boolean;
}) {
  return (
    <ul className={compact ? "mt-3 grid gap-1.5 sm:grid-cols-3" : "mt-3 space-y-1.5"}>
      {options.map((o, oi) => {
        const selected = value === o;
        return (
          <li key={oi}>
            <button
              type="button"
              onClick={() => onChange(o)}
              aria-pressed={selected}
              className={`flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-[13px] ring-1 transition ${
                selected
                  ? "bg-[#19D36B]/12 text-white ring-[#19D36B]/50"
                  : "bg-black/30 text-white/70 ring-white/10 hover:ring-white/25"
              }`}
            >
              <span
                className={`grid size-5 shrink-0 place-items-center rounded-full border text-[11px] font-bold ${
                  selected
                    ? "border-[#19D36B] bg-[#19D36B] text-black"
                    : "border-white/25 text-white/50"
                }`}
              >
                {selected ? "✓" : String.fromCharCode(65 + oi)}
              </span>
              <span>{o}</span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}

/** Typed answer control — one widget per exam kind, Bestway field styling. */
export default function AnswerWidgets({ q, value, onChange, fontSize }: Props) {
  const kind: ExamKind = normalizeKind(q);
  const hasOptions = Array.isArray(q.options) && q.options.length > 0;

  if ((kind === "tfng" || kind === "ynng" || kind === "multiple_choice") && hasOptions) {
    return <OptionButtons options={q.options!} value={value} onChange={onChange} compact={kind !== "multiple_choice"} />;
  }

  if ((kind === "matching" || kind === "map_label") && hasOptions) {
    const opts = q.options!;
    if (opts.length > 4) {
      return (
        <select
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="field mt-3 w-full rounded-xl px-3 py-2.5 text-sm"
          aria-label="Choose matching option"
        >
          <option value="">— Choose —</option>
          {opts.map((o, i) => (
            <option key={i} value={o}>
              {String.fromCharCode(65 + i)}. {o}
            </option>
          ))}
        </select>
      );
    }
    return <OptionButtons options={opts} value={value} onChange={onChange} />;
  }

  if (kind === "essay" || kind === "speaking_prompt") {
    const words = countWords(value);
    const target = kind === "essay" ? (/task 2/i.test(q.prompt + " " + (q.instructions ?? "")) ? 250 : 150) : null;
    const low = target != null && words < target;
    return (
      <div>
        <textarea
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={kind === "essay" ? "Write your answer here…" : "Draft your notes here…"}
          rows={6}
          style={{ fontSize }}
          className="field mt-3 min-h-32 w-full rounded-xl px-3 py-2.5 leading-relaxed"
        />
        <p className={`mt-1.5 font-mono text-[11px] tabular-nums ${low ? "text-white/40" : "text-[#19D36B]"}`}>
          {words} words{target != null ? ` / ${target}+ needed` : ""}
        </p>
      </div>
    );
  }

  // gap_fill + short_answer (+ fallback): strict word-limit aware input.
  const limit = wordLimitFor(q);
  const hint = wordLimitHint(q);
  const words = countWords(value);
  const over = limit != null && words > limit;
  return (
    <div>
      {hint && (
        <p className={`mt-2 text-[10px] font-bold uppercase tracking-[0.14em] ${over ? "text-red-300" : "text-white/35"}`}>
          {hint}{over ? ` — ${words}/${limit} too many` : words > 0 ? ` — ${words}/${limit}` : ""}
        </p>
      )}
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="Type your answer…"
        autoComplete="off"
        spellCheck={false}
        aria-invalid={over || undefined}
        className={`field mt-2 w-full rounded-xl px-3 py-2.5 font-mono text-sm ${
          over ? "!border-red-500/60 !shadow-[0_0_0_3px_rgba(239,68,68,0.15)]" : ""
        }`}
      />
    </div>
  );
}
