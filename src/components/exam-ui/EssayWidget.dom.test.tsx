// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EssayWidget } from "./widgets";
import type { UIQuestion } from "./model";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const question: UIQuestion = {
  id: "q-essay-1",
  number: 1,
  kind: "essay",
  prompt: "Task 2: Discuss the advantages and disadvantages.",
  options: null,
  points: 1,
  wordLimit: null,
};

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  localStorage.clear();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.restoreAllMocks();
});

describe("EssayWidget reliability and Uzbek/IME safety", () => {
  it("recovers once on mount when initial value is empty, but never resurrects intentionally cleared text", () => {
    localStorage.setItem("examui.essay.att-1.q-essay-1", "Old saved essay draft");
    const values: string[] = [];
    let current = "";
    const onChange = (next: string) => {
      current = next;
      values.push(next);
    };

    act(() => {
      root.render(
        <EssayWidget
          q={question}
          value={current}
          onChange={onChange}
          fontSize={16}
          minWords={250}
          attemptId="att-1"
        />,
      );
    });

    // Recovered once on initial mount
    expect(values).toEqual(["Old saved essay draft"]);

    act(() => {
      root.render(
        <EssayWidget
          q={question}
          value={current}
          onChange={onChange}
          fontSize={16}
          minWords={250}
          attemptId="att-1"
        />,
      );
    });

    // Candidate intentionally clears the textarea
    const textarea = container.querySelector("textarea")!;
    act(() => {
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!;
      setter.call(textarea, "");
      textarea.dispatchEvent(new Event("input", { bubbles: true }));
    });
    act(() => {
      root.render(
        <EssayWidget
          q={question}
          value={current}
          onChange={onChange}
          fontSize={16}
          minWords={250}
          attemptId="att-1"
        />,
      );
    });

    expect(current).toBe("");
    expect(localStorage.getItem("examui.essay.att-1.q-essay-1")).toBeNull();
  });

  it("preserves Uzbek characters and Unicode paragraphs without corruption", () => {
    const uzbek = "O‘zbekiston ta’lim tizimi: g‘oya, o‘quvchilar va yangi bosqich.\n\nIkkinchi xatboshi.";
    let current = uzbek;
    act(() => {
      root.render(
        <EssayWidget
          q={question}
          value={current}
          onChange={(v) => { current = v; }}
          fontSize={16}
          minWords={250}
          attemptId="att-2"
        />,
      );
    });
    const textarea = container.querySelector("textarea")!;
    expect(textarea.value).toBe(uzbek);
    expect(container.textContent).toContain("10 / 250 words");
  });
});
