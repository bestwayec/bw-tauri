import { useEffect, useMemo, useRef, useState } from "react";

export interface PassageMarks {
  highlights: string[];
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

function readMarks(storageKey: string, partKey: string): PassageMarks {
  try {
    const raw = localStorage.getItem(`${storageKey}.${partKey}`);
    if (!raw) return { highlights: [], note: "" };
    const p = JSON.parse(raw) as Partial<PassageMarks>;
    return {
      highlights: Array.isArray(p.highlights) ? p.highlights.filter((h) => typeof h === "string") : [],
      note: typeof p.note === "string" ? p.note : "",
    };
  } catch {
    return { highlights: [], note: "" };
  }
}

/** Split text on highlight phrases; matched spans render as <mark>. */
function splitHighlights(text: string, phrases: string[]): Array<{ text: string; mark: boolean }> {
  const live = phrases.filter((h) => h.length > 1 && text.includes(h));
  if (live.length === 0) return [{ text, mark: false }];
  // Longest first so nested phrases resolve to the outer one.
  live.sort((a, b) => b.length - a.length);
  const out: Array<{ text: string; mark: boolean }> = [];
  let rest = text;
  while (rest) {
    let best: string | null = null;
    let at = -1;
    for (const h of live) {
      const i = rest.indexOf(h);
      if (i !== -1 && (at === -1 || i < at)) {
        at = i;
        best = h;
      }
    }
    if (best == null || at === -1) {
      out.push({ text: rest, mark: false });
      break;
    }
    if (at > 0) out.push({ text: rest.slice(0, at), mark: false });
    out.push({ text: best, mark: true });
    rest = rest.slice(at + best.length);
  }
  return out;
}

/**
 * Reading passage with paragraph letters (A, B, C…), text selection tools
 * (Highlight / Clear / Add note) and a private note box. Marks persist to
 * localStorage immediately and to the server when `onPersist` is provided.
 */
export default function PassagePane(p: Props) {
  const [marks, setMarks] = useState<PassageMarks>(() => readMarks(p.storageKey, p.partKey));
  const [menu, setMenu] = useState<{ x: number; y: number; text: string } | null>(null);
  const boxRef = useRef<HTMLDivElement | null>(null);
  const persistTimer = useRef<number | null>(null);
  const onPersistRef = useRef(p.onPersist);
  onPersistRef.current = p.onPersist;

  // Reload marks when the part changes.
  useEffect(() => {
    setMarks(readMarks(p.storageKey, p.partKey));
    setMenu(null);
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

  function doHighlight() {
    if (!menu) return;
    if (!marks.highlights.includes(menu.text)) {
      commit({ ...marks, highlights: [...marks.highlights, menu.text] });
    }
    window.getSelection()?.removeAllRanges();
    setMenu(null);
  }

  function doClear() {
    if (!menu) return;
    const hit = marks.highlights.filter((h) => h.includes(menu.text) || menu.text.includes(h));
    const next = hit.length > 0 ? marks.highlights.filter((h) => !hit.includes(h)) : [];
    commit({ ...marks, highlights: next });
    window.getSelection()?.removeAllRanges();
    setMenu(null);
  }

  function doQuote() {
    if (!menu) return;
    const quote = `> ${menu.text}\n`;
    commit({ ...marks, note: marks.note ? `${marks.note.replace(/\s+$/, "")}\n${quote}` : quote });
    window.getSelection()?.removeAllRanges();
    setMenu(null);
    if (!p.noteOpen) p.onToggleNote();
  }

  return (
    <div className="exam-passagewrap">
      <div
        ref={boxRef}
        onMouseUp={onMouseUp}
        className="exam-passage"
        style={{ fontSize: p.fontSize }}
      >
        {paragraphs.map((para, i) => (
          <div key={i} className="exam-para">
            <span className="exam-para-letter" aria-hidden="true">
              {String.fromCharCode(65 + i)}
            </span>
            <p>
              {splitHighlights(para, marks.highlights).map((s, j) =>
                s.mark ? (
                  <mark key={j} className="exam-mark">
                    {s.text}
                  </mark>
                ) : (
                  <span key={j}>{s.text}</span>
                ),
              )}
            </p>
          </div>
        ))}
        {menu && (
          <div
            className="exam-selmenu"
            style={{ left: Math.max(8, menu.x), top: Math.max(8, menu.y) }}
            role="menu"
            aria-label="Text tools"
          >
            <button type="button" role="menuitem" onClick={doHighlight} className="exam-selbtn">
              Highlight
            </button>
            <button type="button" role="menuitem" onClick={doClear} className="exam-selbtn">
              Clear
            </button>
            <button type="button" role="menuitem" onClick={doQuote} className="exam-selbtn">
              Add note
            </button>
          </div>
        )}
      </div>
      {p.noteOpen && (
        <div className="exam-notebox">
          <p className="exam-notehead">My notes (private — not graded)</p>
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
