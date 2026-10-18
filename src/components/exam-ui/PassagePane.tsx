import { useEffect, useMemo, useRef, useState } from "react";

export interface StickyMarginNote {
  id: string;
  quote: string;
  comment: string;
  createdAt: string;
}

export type HighlightColor = "yellow" | "green" | "pink";

export interface PassageMarks {
  highlights: string[];
  highlightColors?: Record<string, HighlightColor>;
  underlines?: string[];
  stickyNotes?: StickyMarginNote[];
  note: string;
}

type Props = {
  partKey: string;
  passageText: string;
  fontSize: number;
  /** localStorage namespace, e.g. `examui.marks.<attemptId>`. */
  storageKey: string;
  /** Optional server sync (legacy tests flow). Mock flow omits it. */
  onPersist?: (partKey: string, marks: PassageMarks) => void;
  noteOpen: boolean;
  onToggleNote: () => void;
};

export function readMarks(storageKey: string, partKey: string): PassageMarks {
  try {
    const raw = localStorage.getItem(`${storageKey}.${partKey}`);
    if (!raw) return { highlights: [], highlightColors: {}, underlines: [], stickyNotes: [], note: "" };
    const p = JSON.parse(raw) as Partial<PassageMarks>;
    return {
      highlights: Array.isArray(p.highlights) ? p.highlights.filter((h) => typeof h === "string") : [],
      highlightColors: p.highlightColors && typeof p.highlightColors === "object" ? p.highlightColors : {},
      underlines: Array.isArray(p.underlines) ? p.underlines.filter((u) => typeof u === "string") : [],
      stickyNotes: Array.isArray(p.stickyNotes)
        ? p.stickyNotes.filter(
            (n): n is StickyMarginNote =>
              !!n && typeof n === "object" && typeof n.id === "string" && typeof n.comment === "string",
          )
        : [],
      note: typeof p.note === "string" ? p.note : "",
    };
  } catch {
    return { highlights: [], highlightColors: {}, underlines: [], stickyNotes: [], note: "" };
  }
}

export interface TextSegment {
  text: string;
  mark: boolean;
  highlightColor?: HighlightColor;
  underline: boolean;
}

/** Split text on highlight and underline phrases cleanly, with color attribution. */
export function splitMarks(
  text: string,
  phrases: string[],
  underlines: string[] = [],
  colorMap?: Record<string, HighlightColor>,
): TextSegment[] {
  if (!text) return [];
  const len = text.length;
  // 0: none, 1: yellow, 2: green, 3: pink
  const isMark = new Uint8Array(len);
  const isUnderline = new Uint8Array(len);

  const colorCodes: Record<HighlightColor, number> = {
    yellow: 1,
    green: 2,
    pink: 3,
  };
  const codeToColor: Record<number, HighlightColor> = {
    1: "yellow",
    2: "green",
    3: "pink",
  };

  const applyRanges = (list: string[], target: Uint8Array, useColors = false) => {
    for (const phrase of list) {
      if (!phrase || phrase.length < 2) continue;
      const code = useColors ? (colorMap?.[phrase] ? colorCodes[colorMap[phrase]] : 1) : 1;
      let startIdx = 0;
      while (startIdx < len) {
        const at = text.indexOf(phrase, startIdx);
        if (at === -1) break;
        for (let i = at; i < at + phrase.length; i++) target[i] = code;
        startIdx = at + 1;
      }
    }
  };

  applyRanges(phrases, isMark, true);
  applyRanges(underlines, isUnderline, false);

  const out: TextSegment[] = [];
  let cur = 0;
  for (let i = 1; i <= len; i++) {
    const same = i < len && isMark[i] === isMark[cur] && isUnderline[i] === isUnderline[cur];
    if (!same || i === len) {
      out.push({
        text: text.slice(cur, i),
        mark: isMark[cur] > 0,
        highlightColor: isMark[cur] > 0 ? codeToColor[isMark[cur]] ?? "yellow" : undefined,
        underline: isUnderline[cur] === 1,
      });
      cur = i;
    }
  }
  return out;
}

/**
 * Reading passage with paragraph letters (A, B, C…), text selection tools
 * (Highlight / Underline / Clear / Add margin note) and a private Margin Notes drawer.
 * Marks persist to localStorage immediately and to the server when `onPersist` is provided.
 */
export default function PassagePane(p: Props) {
  const [marks, setMarks] = useState<PassageMarks>(() => readMarks(p.storageKey, p.partKey));
  const [menu, setMenu] = useState<{ x: number; y: number; text: string } | null>(null);
  const [newStickyComment, setNewStickyComment] = useState("");
  const [pendingQuote, setPendingQuote] = useState<string>("");
  const boxRef = useRef<HTMLDivElement | null>(null);
  const persistTimer = useRef<number | null>(null);
  const onPersistRef = useRef(p.onPersist);
  onPersistRef.current = p.onPersist;

  // Reload marks when the part changes.
  useEffect(() => {
    setMarks(readMarks(p.storageKey, p.partKey));
    setMenu(null);
    setPendingQuote("");
    setNewStickyComment("");
  }, [p.storageKey, p.partKey]);

  useEffect(
    () => () => {
      if (persistTimer.current) window.clearTimeout(persistTimer.current);
    },
    [],
  );

  const paragraphs = useMemo(
    () => p.passageText.split(/\n\s*\n/).map((t) => t.trim()).filter(Boolean),
    [p.passageText],
  );

  function commit(next: PassageMarks) {
    setMarks(next);
    try {
      localStorage.setItem(`${p.storageKey}.${p.partKey}`, JSON.stringify(next));
    } catch {
      /* private mode — memory only */
    }
    if (persistTimer.current) window.clearTimeout(persistTimer.current);
    persistTimer.current = window.setTimeout(() => {
      try {
        onPersistRef.current?.(p.partKey, next);
      } catch {
        /* server sync is best-effort */
      }
    }, 800);
  }

  function selectionInBox(): { text: string; rect: DOMRect } | null {
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed) return null;
    const text = sel.toString().trim();
    if (text.length < 2 || !boxRef.current?.contains(sel.anchorNode)) return null;
    const range = sel.getRangeAt(0);
    const rect = range.getBoundingClientRect();
    const host = boxRef.current.getBoundingClientRect();
    return { text, rect: new DOMRect(rect.left - host.left, rect.top - host.top, rect.width, rect.height) };
  }

  function onMouseUp() {
    // Let the selection settle before measuring.
    window.setTimeout(() => {
      const s = selectionInBox();
      setMenu(s ? { x: Math.min(s.rect.left, 320), y: s.rect.top - 44, text: s.text } : null);
    }, 10);
  }

  function doHighlight(color: HighlightColor = "yellow") {
    if (!menu) return;
    const curColors = { ...(marks.highlightColors ?? {}) };
    curColors[menu.text] = color;
    if (!marks.highlights.includes(menu.text)) {
      commit({ ...marks, highlights: [...marks.highlights, menu.text], highlightColors: curColors });
    } else {
      commit({ ...marks, highlightColors: curColors });
    }
    window.getSelection()?.removeAllRanges();
    setMenu(null);
  }

  function doUnderline() {
    if (!menu) return;
    const cur = marks.underlines ?? [];
    if (!cur.includes(menu.text)) {
      commit({ ...marks, underlines: [...cur, menu.text] });
    }
    window.getSelection()?.removeAllRanges();
    setMenu(null);
  }

  /** Add a phrase once — repeated Alt+H/Alt+U must never stack duplicates. */
  function addPhrase(kind: "highlight" | "underline", text: string, color: HighlightColor = "yellow") {
    const pair = text.trim();
    if (pair.length < 2) return;
    if (kind === "highlight") {
      const curColors = { ...(marks.highlightColors ?? {}) };
      curColors[pair] = color;
      if (marks.highlights.includes(pair)) {
        commit({ ...marks, highlightColors: curColors });
        return;
      }
      commit({ ...marks, highlights: [...marks.highlights, pair], highlightColors: curColors });
    } else {
      const cur = marks.underlines ?? [];
      if (cur.includes(pair)) return;
      commit({ ...marks, underlines: [...cur, pair] });
    }
  }

  function doClear() {
    if (!menu) return;
    const hitH = marks.highlights.filter((h) => h.includes(menu.text) || menu.text.includes(h));
    const nextH = hitH.length > 0 ? marks.highlights.filter((h) => !hitH.includes(h)) : marks.highlights;
    const nextColors = { ...(marks.highlightColors ?? {}) };
    for (const h of hitH) delete nextColors[h];
    delete nextColors[menu.text];
    const hitU = (marks.underlines ?? []).filter((u) => u.includes(menu.text) || menu.text.includes(u));
    const nextU = hitU.length > 0 ? (marks.underlines ?? []).filter((u) => !hitU.includes(u)) : (marks.underlines ?? []);
    commit({ ...marks, highlights: nextH, highlightColors: nextColors, underlines: nextU });
    window.getSelection()?.removeAllRanges();
    setMenu(null);
  }

  function doQuote() {
    if (!menu) return;
    const quote = `> ${menu.text}\n`;
    const nextHighlights = marks.highlights.includes(menu.text)
      ? marks.highlights
      : [...marks.highlights, menu.text];
    setPendingQuote(menu.text);
    commit({
      ...marks,
      highlights: nextHighlights,
      note: marks.note ? `${marks.note.replace(/\s+$/, "")}\n${quote}` : quote,
    });
    window.getSelection()?.removeAllRanges();
    setMenu(null);
    if (!p.noteOpen) p.onToggleNote();
  }

  function addStickyNote() {
    const comment = newStickyComment.trim();
    if (!comment && !pendingQuote) return;
    const entry: StickyMarginNote = {
      id: `note-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      quote: pendingQuote,
      comment: comment || pendingQuote,
      createdAt: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
    };
    const nextSticky = [...(marks.stickyNotes ?? []), entry];
    commit({ ...marks, stickyNotes: nextSticky });
    setNewStickyComment("");
    setPendingQuote("");
  }

  function removeStickyNote(id: string) {
    const nextSticky = (marks.stickyNotes ?? []).filter((n) => n.id !== id);
    commit({ ...marks, stickyNotes: nextSticky });
  }

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        setMenu(null);
        return;
      }
      if (e.altKey && (e.key === "h" || e.key === "H")) {
        e.preventDefault();
        const s = selectionInBox();
        if (s) {
          addPhrase("highlight", s.text);
          window.getSelection()?.removeAllRanges();
          setMenu(null);
        }
      } else if (e.altKey && (e.key === "u" || e.key === "U")) {
        e.preventDefault();
        const s = selectionInBox();
        if (s) {
          addPhrase("underline", s.text);
          window.getSelection()?.removeAllRanges();
          setMenu(null);
        }
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [marks]);

  const stickyList = marks.stickyNotes ?? [];

  return (
    <div className="exam-passagewrap">
      <div
        ref={boxRef}
        onMouseUp={onMouseUp}
        onTouchEnd={() => window.setTimeout(onMouseUp, 100)}
        className="exam-passage"
        style={{ fontSize: p.fontSize }}
      >
        {paragraphs.map((para, i) => (
          <div key={i} className="exam-para">
            <span className="exam-para-letter" aria-hidden="true">
              {String.fromCharCode(65 + i)}
            </span>
            <p>
              {splitMarks(para, marks.highlights, marks.underlines ?? [], marks.highlightColors).map((s, j) => {
                let node: React.ReactNode = <span>{s.text}</span>;
                if (s.underline) {
                  node = (
                    <span
                      style={{
                        textDecoration: "underline",
                        textDecorationColor: "#38bdf8",
                        textDecorationThickness: "2.5px",
                        textUnderlineOffset: "3px",
                      }}
                    >
                      {node}
                    </span>
                  );
                }
                if (s.mark) {
                  const color = s.highlightColor ?? "yellow";
                  const bg = color === "green" ? "#bbf7d0" : color === "pink" ? "#fbcfe8" : "#fef08a";
                  const textCol = color === "green" ? "#14532d" : color === "pink" ? "#831843" : "#713f12";
                  node = (
                    <mark
                      className={`exam-mark exam-mark-${color}`}
                      style={{ backgroundColor: bg, color: textCol, borderRadius: 2, padding: "0 2px" }}
                    >
                      {node}
                    </mark>
                  );
                }
                return <span key={j}>{node}</span>;
              })}
            </p>
          </div>
        ))}
        {menu && (
          <div
            className="exam-selmenu flex items-center gap-1.5 p-1 rounded-lg bg-[#0B0F17]/95 border border-white/10 shadow-2xl backdrop-blur-md"
            style={{ left: Math.max(8, menu.x), top: Math.max(8, menu.y) }}
            role="menu"
            aria-label="Text tools"
            onMouseDown={(e) => e.preventDefault()}
          >
            <button
              type="button"
              role="menuitem"
              onClick={() => doHighlight("yellow")}
              className="flex items-center gap-1 px-2 py-1 rounded text-xs font-semibold bg-[#fef08a] text-[#713f12] hover:brightness-105 transition-all shadow-sm"
              title="Highlight Yellow (#fef08a)"
            >
              <span className="w-2 h-2 rounded-full bg-amber-400" />
              Yellow
            </button>
            <button
              type="button"
              role="menuitem"
              onClick={() => doHighlight("green")}
              className="flex items-center gap-1 px-2 py-1 rounded text-xs font-semibold bg-[#bbf7d0] text-[#14532d] hover:brightness-105 transition-all shadow-sm"
              title="Highlight Green (#bbf7d0)"
            >
              <span className="w-2 h-2 rounded-full bg-emerald-500" />
              Green
            </button>
            <button
              type="button"
              role="menuitem"
              onClick={() => doHighlight("pink")}
              className="flex items-center gap-1 px-2 py-1 rounded text-xs font-semibold bg-[#fbcfe8] text-[#831843] hover:brightness-105 transition-all shadow-sm"
              title="Highlight Pink (#fbcfe8)"
            >
              <span className="w-2 h-2 rounded-full bg-pink-400" />
              Pink
            </button>
            <div className="w-[1px] h-4 bg-white/20 mx-0.5" />
            <button type="button" role="menuitem" onClick={doUnderline} className="exam-selbtn" title="Alt+U">
              Underline
            </button>
            <button type="button" role="menuitem" onClick={doClear} className="exam-selbtn">
              Clear
            </button>
            <button type="button" role="menuitem" onClick={doQuote} className="exam-selbtn font-medium text-emerald-400">
              + Note
            </button>
          </div>
        )}
      </div>
      {p.noteOpen && (
        <div className="exam-notebox" role="region" aria-label="Margin notes and highlights">
          <div className="flex items-center justify-between gap-2 mb-2">
            <p className="exam-notehead">Margin Notes & Sticky Annotations ({stickyList.length})</p>
            {marks.highlights.length > 0 && (
              <button
                type="button"
                onClick={() => commit({ ...marks, highlights: [], underlines: [] })}
                className="exam-btn-ghost exam-btn-xs"
              >
                Clear {marks.highlights.length} highlight{marks.highlights.length === 1 ? "" : "s"}
              </button>
            )}
          </div>

          {stickyList.length > 0 && (
            <ul className="mb-3 space-y-2">
              {stickyList.map((item) => (
                <li
                  key={item.id}
                  className="rounded-lg border border-[var(--ex-line)] bg-[var(--ex-field)] p-2.5 text-xs"
                >
                  {item.quote && (
                    <blockquote className="mb-1 border-l-2 border-amber-400 pl-2 italic opacity-80">
                      &ldquo;{item.quote}&rdquo;
                    </blockquote>
                  )}
                  <div className="flex items-start justify-between gap-2">
                    <span className="font-medium">{item.comment}</span>
                    <button
                      type="button"
                      onClick={() => removeStickyNote(item.id)}
                      aria-label="Delete margin note"
                      className="text-[11px] opacity-60 hover:opacity-100"
                    >
                      ✕
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}

          <div className="mb-3 flex gap-2">
            <input
              type="text"
              value={newStickyComment}
              onChange={(e) => setNewStickyComment(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  addStickyNote();
                }
              }}
              placeholder={pendingQuote ? `Add sticky note for "${pendingQuote.slice(0, 28)}…"` : "Add a sticky margin note…"}
              className="exam-input text-xs"
            />
            <button type="button" onClick={addStickyNote} className="exam-btn-primary exam-btn-xs shrink-0">
              + Pin
            </button>
          </div>

          <p className="exam-notehead">Scratchpad (private — not graded)</p>
          <textarea
            value={marks.note}
            onChange={(e) => commit({ ...marks, note: e.target.value })}
            rows={3}
            placeholder="Type notes about this passage…"
            className="exam-notearea"
          />
        </div>
      )}
    </div>
  );
}
