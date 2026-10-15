import { useEffect, useMemo, useRef, useState } from "react";

export interface PassageMarks {
  highlights: string[];
  underlines?: string[];
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
    if (!raw) return { highlights: [], underlines: [], note: "" };
    const p = JSON.parse(raw) as Partial<PassageMarks>;
    return {
      highlights: Array.isArray(p.highlights) ? p.highlights.filter((h) => typeof h === "string") : [],
      underlines: Array.isArray(p.underlines) ? p.underlines.filter((u) => typeof u === "string") : [],
      note: typeof p.note === "string" ? p.note : "",
    };
  } catch {
    return { highlights: [], underlines: [], note: "" };
  }
}

interface TextSegment {
  text: string;
  mark: boolean;
  underline: boolean;
}

/** Split text on highlight and underline phrases cleanly. */
function splitMarks(text: string, phrases: string[], underlines: string[] = []): TextSegment[] {
  if (!text) return [];
  const len = text.length;
  const isMark = new Uint8Array(len);
  const isUnderline = new Uint8Array(len);

  const applyRanges = (list: string[], target: Uint8Array) => {
    for (const phrase of list) {
      if (!phrase || phrase.length < 2) continue;
      let startIdx = 0;
      while (startIdx < len) {
        const at = text.indexOf(phrase, startIdx);
        if (at === -1) break;
        for (let i = at; i < at + phrase.length; i++) target[i] = 1;
        startIdx = at + 1;
      }
    }
  };

  applyRanges(phrases, isMark);
  applyRanges(underlines, isUnderline);

  const out: TextSegment[] = [];
  let cur = 0;
  for (let i = 1; i <= len; i++) {
    const same = i < len && isMark[i] === isMark[cur] && isUnderline[i] === isUnderline[cur];
    if (!same || i === len) {
      out.push({
        text: text.slice(cur, i),
        mark: isMark[cur] === 1,
        underline: isUnderline[cur] === 1,
      });
      cur = i;
    }
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

  function doUnderline() {
    if (!menu) return;
    const cur = marks.underlines ?? [];
    if (!cur.includes(menu.text)) {
      commit({ ...marks, underlines: [...cur, menu.text] });
    }
    window.getSelection()?.removeAllRanges();
    setMenu(null);
  }

  function doClear() {
    if (!menu) return;
    const hitH = marks.highlights.filter((h) => h.includes(menu.text) || menu.text.includes(h));
    const nextH = hitH.length > 0 ? marks.highlights.filter((h) => !hitH.includes(h)) : marks.highlights;
    const hitU = (marks.underlines ?? []).filter((u) => u.includes(menu.text) || menu.text.includes(u));
    const nextU = hitU.length > 0 ? (marks.underlines ?? []).filter((u) => !hitU.includes(u)) : (marks.underlines ?? []);
    commit({ ...marks, highlights: nextH, underlines: nextU });
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
          commit({ ...marks, highlights: [...marks.highlights, s.text] });
          window.getSelection()?.removeAllRanges();
          setMenu(null);
        }
      } else if (e.altKey && (e.key === "u" || e.key === "U")) {
        e.preventDefault();
        const s = selectionInBox();
        if (s) {
          const cur = marks.underlines ?? [];
          commit({ ...marks, underlines: [...cur, s.text] });
          window.getSelection()?.removeAllRanges();
          setMenu(null);
        }
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [marks]);

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
              {splitMarks(para, marks.highlights, marks.underlines ?? []).map((s, j) => {
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
                  node = <mark className="exam-mark">{node}</mark>;
                }
                return <span key={j}>{node}</span>;
              })}
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
            <button type="button" role="menuitem" onClick={doHighlight} className="exam-selbtn" title="Alt+H">
              Highlight
            </button>
            <button type="button" role="menuitem" onClick={doUnderline} className="exam-selbtn" title="Alt+U">
              Underline
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
