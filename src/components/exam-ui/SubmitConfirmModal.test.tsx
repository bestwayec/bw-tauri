import { Children, isValidElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { SubmitConfirmBody, summariseNumbers } from "./SubmitConfirmModal";

type ModalProps = Parameters<typeof SubmitConfirmBody>[0];

function renderModal(props: Partial<ModalProps> = {}) {
  return renderToStaticMarkup(
    <SubmitConfirmBody
      open
      answered={18}
      total={40}
      flagged={3}
      unansweredNumbers={[2, 5, 9]}
      submitting={false}
      submitLabel="Submit Reading"
      onCancel={() => {}}
      onConfirm={() => {}}
      {...props}
    />,
  );
}

describe("submit confirmation", () => {
  it("reports answered, empty and flagged counts before submitting", () => {
    const html = renderModal();
    expect(html).toContain('role="dialog"');
    expect(html).toContain("18");
    expect(html).toContain("of <strong>40</strong>");
    expect(html).toContain("22 still empty");
    expect(html).toContain("3 flagged for review");
    expect(html).toContain("Q2, Q5, Q9");
    expect(html).toContain("Submit Reading");
  });

  it("says nothing is left empty when every question is answered", () => {
    const html = renderModal({ answered: 40, unansweredNumbers: [], flagged: 0 });
    expect(html).toContain("nothing left empty");
    expect(html).not.toContain("Unanswered questions");
  });

  it("renders nothing while closed and blocks actions while submitting", () => {
    expect(renderModal({ open: false })).toBe("");
    const html = renderModal({ submitting: true });
    expect(html).toContain("Submitting…");
    expect((html.match(/disabled=""/g) ?? []).length).toBe(2);
  });

  it("caps the unanswered question list", () => {
    const many = Array.from({ length: 30 }, (_, i) => i + 1);
    expect(summariseNumbers(many, 12)).toEqual({ shown: many.slice(0, 12), hidden: 18 });
    expect(summariseNumbers([1, 2], 12)).toEqual({ shown: [1, 2], hidden: 0 });
    expect(renderModal({ answered: 10, unansweredNumbers: many })).toContain("+18 more");
  });

  it("wires confirm and cancel to the runner", () => {
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    const tree = SubmitConfirmBody({
      open: true,
      answered: 1,
      total: 2,
      flagged: 0,
      unansweredNumbers: [2],
      submitting: false,
      submitLabel: "Submit",
      onCancel,
      onConfirm,
    });
    const buttons = collect(tree);
    // "Keep working" first, then the submit action.
    buttons[0].props.onClick?.();
    buttons[1].props.onClick?.();
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });
});

function collect(node: ReactNode): ReactElement<{ onClick?: () => void }>[] {
  return Children.toArray(node).flatMap((child) => {
    if (!isValidElement(child)) return [];
    const element = child as ReactElement<{ children?: ReactNode; onClick?: () => void }>;
    return element.type === "button" ? [element] : collect(element.props.children);
  });
}
