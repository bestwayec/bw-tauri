import { Fragment, createElement, useMemo, type ReactNode } from "react";

export interface GappedQuestionRef {
  id: string;
  number: number;
}

export interface GappedSlot {
  number: number;
  question: GappedQuestionRef | null;
}

/** True when the group carries a gapped rich document (notes/table/summary). */
export function hasGappedDocument(contentHtml: string | null | undefined): contentHtml is string {
  return !!contentHtml?.trim();
}

/**
 * Gap token scanner (pure — unit-testable without a DOM):
 * finds `<span data-gap="N"></span>` atoms, N in 1..200.
 */
const GAP_TOKEN_RE = /<span\s+data-gap="(\d{1,3})"[^>]*>[\s\S]*?<\/span>/g;

export function gapNumbersIn(html: string): number[] {
  const out: number[] = [];
  GAP_TOKEN_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = GAP_TOKEN_RE.exec(html)) !== null) {
    const n = Number(m[1]);
    if (n >= 1 && n <= 200) out.push(n);
  }
  return out;
}

function parseGapNumber(raw: string | null): number | null {
  if (!raw || !/^\d{1,3}$/.test(raw)) return null;
  const n = Number(raw);
  return n >= 1 && n <= 200 ? n : null;
}

// Tags the backend allowlist permits (see backend mock-content.ts).
// Everything else is dropped; script/style/media/link content is dropped WITH
// its children, unknown formatting tags keep their children.
const ALLOWED = new Set([
  "p",
  "br",
  "strong",
  "em",
  "u",
  "ul",
  "ol",
  "li",
  "table",
  "thead",
  "tbody",
  "tr",
  "th",
  "td",
  "h3",
  "h4",
]);

const DROP_WITH_CONTENT = new Set([
  "script",
  "style",
  "iframe",
  "img",
  "audio",
  "video",
  "a",
  "button",
  "input",
  "form",
  "select",
  "textarea",
]);

// Whitespace-only text is meaningless inside these containers and only trips
// React's DOM-nesting validation — skip it there.
const TIGHT_PARENTS = new Set(["table", "thead", "tbody", "tr", "ul", "ol"]);

function renderNodes(
  nodes: ChildNode[],
  parentTag: string,
  renderGap: (slot: GappedSlot) => ReactNode,
  byNumber: Map<number, GappedQuestionRef>,
  keyPrefix: string,
): ReactNode[] {
  const out: ReactNode[] = [];
  nodes.forEach((node, i) => {
    const key = `${keyPrefix}-${i}`;
    if (node.nodeType === Node.TEXT_NODE) {
      const text = node.textContent ?? "";
      if (!text) return;
      if (text.trim() === "" && TIGHT_PARENTS.has(parentTag)) return;
      out.push(<Fragment key={key}>{text}</Fragment>);
      return;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return;
    const el = node as Element;
    const tag = el.tagName.toLowerCase();
    // Gap atom — never a container: drop children, render the slot.
    if (tag === "span" && el.hasAttribute("data-gap")) {
      const n = parseGapNumber(el.getAttribute("data-gap"));
      if (n != null) {
        out.push(
          <Fragment key={key}>{renderGap({ number: n, question: byNumber.get(n) ?? null })}</Fragment>,
        );
      }
      return;
    }
    if (DROP_WITH_CONTENT.has(tag)) return;
    const children = renderNodes(Array.from(el.childNodes), tag, renderGap, byNumber, key);
    if (!ALLOWED.has(tag)) {
      // Unknown tag: keep readable content, drop the wrapper.
      out.push(<Fragment key={key}>{children}</Fragment>);
      return;
    }
    out.push(createElement(tag, { key }, ...children));
  });
  return out;
}

export interface GappedContentProps {
  contentHtml: string;
  questions: GappedQuestionRef[];
  renderGap: (slot: GappedSlot) => ReactNode;
  className?: string;
}

/**
 * Rich gapped-document renderer (IELTS notes/table/summary completion).
 * Defense in depth: the document is re-built from an allowlist via DOMParser —
 * only `p/br/strong/em/u/ul/ol/li/table/* /h3/h4` survive, no attributes are
 * ever copied except the numeric `data-gap`, so stored HTML cannot inject
 * scripts, handlers, or links at this boundary (backend sanitizes too).
 */
export function GappedContent({ contentHtml, questions, renderGap, className }: GappedContentProps) {
  const byNumber = useMemo(
    () => new Map(questions.map((q) => [q.number, q])),
    [questions],
  );

  // Parse + render on every render (like the web client): the tree embeds live
  // inputs, so a memoized tree would freeze typed answers. Gapped docs are a
  // few KB — re-parsing per keystroke is negligible.
  let rendered: ReactNode[] | null = null;
  if (typeof DOMParser !== "undefined") {
    try {
      const body = Array.from(
        new DOMParser().parseFromString(contentHtml, "text/html").body.childNodes,
      );
      rendered = renderNodes(body, "root", renderGap, byNumber, "g");
    } catch {
      rendered = null;
    }
  }

  if (rendered == null) {
    return (
      <p className="text-xs text-white/40">
        This part&apos;s document could not be displayed. Answer from the material on the left.
      </p>
    );
  }

  return <div className={`gapped-content min-w-0 text-sm leading-relaxed text-white/90 ${className ?? ""}`}>{rendered}</div>;
}

export default GappedContent;
