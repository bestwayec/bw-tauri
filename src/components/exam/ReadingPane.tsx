import { useMemo } from "react";

type Props = {
  passage: string;
  fontSize: number;
  instructions: string | null;
  highlights: string[];
  note: string;
  onHighlightsChange: (next: string[]) => void;
  onNoteChange: (next: string) => void;
};

/** Escape for RegExp construction. */
function esc(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Reading material pane: instructions + highlightable passage + private note.
 * Controlled — the runner owns persistence (localStorage first, debounced
 * server sync). Works fully offline; server failures are silent by design.
 */
export default function ReadingPane({
  passage,
  fontSize,
  instructions,
  highlights,
  note,
  onHighlightsChange,
  onNoteChange,
}: Props) {
  function highlightSelection() {
    const sel = window.getSelection()?.toString().trim() ?? "";
    if (!sel || sel.length < 2) return;
    // Cap length so accidental whole-passage selections don't flood storage.
    const clipped = sel.slice(0, 300);
    if (highlights.includes(clipped)) return;
    onHighlightsChange([...highlights, clipped].slice(0, 50));
    window.getSelection()?.removeAllRanges();
  }

  function clearHighlights() {
    onHighlightsChange([]);
  }

  const segments = useMemo(() => {
    if (highlights.length === 0) return [{ text: passage, mark: false }];
    const pattern = new RegExp(`(${highlights.map(esc).join("|")})`, "g");
    const out: { text: string; mark: boolean }[] = [];
    let last = 0;
    let m: RegExpExecArray | null;
    // Guard against pathological patterns.
    try {
      while ((m = pattern.exec(passage)) !== null) {
        if (m.index > last) out.push({ text: passage.slice(last, m.index), mark: false });
        out.push({ text: m[0], mark: true });
        last = m.index + m[0].length;
        if (out.length > 500) break;
      }
    } catch {
      return [{ text: passage, mark: false }];
    }
    if (last < passage.length) out.push({ text: passage.slice(last), mark: false });
    return out;
  }, [passage, highlights]);

  return (
    <div>
      {instructions && (
        <div className="rounded-xl bg-[#19D36B]/[0.06] px-3.5 py-2.5 text-xs leading-relaxed text-emerald-100/90 ring-1 ring-[#19D36B]/20">
          <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-[#19D36B]/80">Instructions</p>
          <p className="mt-1 whitespace-pre-wrap">{instructions}</p>
        </div>
      )}
      <div className="mt-3 rounded-xl bg-black/30 ring-1 ring-white/10">
        <div className="flex items-center justify-between gap-2 border-b border-white/[0.07] px-3.5 py-2">
          <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-white/35">
            Passage{highlights.length > 0 ? ` · ${highlights.length} highlighted` : ""}
          </p>
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={highlightSelection}
              title="Highlight the selected text"
              className="rounded-lg bg-[#19D36B]/10 px-2 py-1 text-[11px] font-bold text-[#19D36B] ring-1 ring-[#19D36B]/30 hover:bg-[#19D36B]/20"
            >
              🖍 Highlight
            </button>
            {highlights.length > 0 && (
              <button
                type="button"
                onClick={clearHighlights}
                title="Clear highlights in this part"
                className="rounded-lg px-2 py-1 text-[11px] text-white/40 hover:text-white"
              >
                Clear
              </button>
            )}
          </div>
        </div>
        <div
          className="max-h-[46vh] overflow-y-auto px-3.5 py-3 leading-relaxed text-white/75"
          style={{ fontSize }}
        >
          <p className="whitespace-pre-wrap">
            {segments.map((s, i) =>
              s.mark ? (
                <mark key={i} className="rounded bg-[#19D36B]/30 px-0.5 text-emerald-50">
                  {s.text}
                </mark>
              ) : (
                <span key={i}>{s.text}</span>
              ),
            )}
          </p>
          <p className="mt-2 text-[11px] text-white/25">Select text, then press Highlight.</p>
        </div>
      </div>
      <div className="mt-3 rounded-xl bg-black/30 px-3.5 py-2.5 ring-1 ring-white/10">
        <label className="text-[10px] font-bold uppercase tracking-[0.16em] text-white/35">
          My notes (synced when online)
        </label>
        <textarea
          value={note}
          onChange={(e) => onNoteChange(e.target.value.slice(0, 2000))}
          placeholder="Jot down key lines, paragraph mapping…"
          rows={2}
          className="field mt-1.5 w-full rounded-lg px-2.5 py-2 text-xs leading-relaxed"
        />
      </div>
    </div>
  );
}
