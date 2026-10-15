import { useEffect } from "react";
import {
  MOCK_SECTION_ICON,
  MOCK_SECTION_MINUTES,
  MOCK_SKILLS,
  MOCK_SKILL_LABEL,
  type MockAttemptMode,
  type MockExamListItem,
  type MockSkill,
} from "@/lib/mocks";

/** What the student picked before the attempt is started on the server. */
export interface MockStartChoice {
  mode: MockAttemptMode;
  flow: "single_skill" | "full_test";
  section?: MockSkill;
}

type Props = {
  exam: Pick<MockExamListItem, "title" | "type" | "profile" | "skills" | "questionCount">;
  mode: MockAttemptMode;
  onCancel: () => void;
  onStart: (choice: MockStartChoice) => void;
  /** A start request is in flight — all actions are disabled. */
  busy?: boolean;
  error?: string | null;
};

/**
 * Full Mock needs a `full_mock` exam blueprint — the backend rejects
 * `flow: 'full_test'` for practice exams (MOCK_FULL_TEST_UNAVAILABLE).
 */
export function supportsFullMock(exam: Pick<MockExamListItem, "profile">): boolean {
  return exam.profile === "full_mock";
}

/** Single sections offered for this exam; a section without content is disabled. */
export function sectionChoices(
  exam: Pick<MockExamListItem, "skills">,
): Array<{ skill: MockSkill; enabled: boolean }> {
  const available = new Set(exam.skills);
  return MOCK_SKILLS.map((skill) => ({ skill, enabled: available.has(skill) }));
}

export function fullMockChoice(mode: MockAttemptMode): MockStartChoice {
  return { mode, flow: "full_test" };
}

export function singleSectionChoice(mode: MockAttemptMode, skill: MockSkill): MockStartChoice {
  return { mode, flow: "single_skill", section: skill };
}

/**
 * Start-of-exam choice: take the whole Full Mock in one sitting, or practise a
 * single section. A single-section attempt is scoped server-side (`section` /
 * `section_filter` / `skills`), so the runner receives — and shows — only that
 * section's parts and timer; the other sections are never downloaded and are
 * not required at submit time.
 */
export default function MockSectionPicker(props: Props) {
  const { onCancel } = props;
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onCancel();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onCancel]);
  return <MockSectionBody {...props} />;
}

/** Hook-free dialog markup (Escape handling lives in the wrapper above). */
export function MockSectionBody({ exam, mode, onCancel, onStart, busy, error }: Props) {
  const fullMock = supportsFullMock(exam);
  const sections = sectionChoices(exam);
  const timed = mode === "timed";

  return (
    <div
      className="fixed inset-0 z-[80] grid place-items-center overflow-y-auto bg-black/70 p-4 backdrop-blur-sm"
      onClick={onCancel}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="mock-start-title"
        className="card w-full max-w-2xl rounded-2xl border-white/10 bg-[#0B0F17] p-5 shadow-[0_24px_70px_rgba(0,0,0,0.6)]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-violet-300/70">
              {timed ? "Timed mock" : "Practice mock"} · {exam.type === "multilevel" ? "Multilevel" : "IELTS"}
            </p>
            <h2 id="mock-start-title" className="mt-1 text-xl font-black tracking-tight text-white">
              {exam.title}
            </h2>
            <p className="mt-1 text-sm text-white/50">
              Choose the whole exam or a single section. Only what you pick is downloaded and timed.
            </p>
          </div>
          <button
            type="button"
            aria-label="Close"
            onClick={onCancel}
            className="shrink-0 rounded-lg px-2 py-1 text-sm text-white/40 ring-1 ring-white/10 hover:text-white"
          >
            ✕
          </button>
        </div>

        {error && (
          <p role="alert" className="mt-3 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300">
            {error}
          </p>
        )}

        {/* Full Mock */}
        <div className="mt-4">
          <h3 className="text-xs font-bold uppercase tracking-widest text-white/40">Full exam</h3>
          <button
            type="button"
            disabled={!fullMock || busy}
            onClick={() => onStart(fullMockChoice(mode))}
            className="card mt-2 flex w-full items-center gap-4 rounded-2xl p-4 text-left transition enabled:hover:border-brand/25 disabled:opacity-40"
          >
            <span className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-brand/10 text-2xl ring-1 ring-brand/25">
              🏁
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-base font-bold text-white">Full Mock Exam</span>
              <span className="mt-0.5 block text-[11px] text-white/40">
                🎧 Listening → 📖 Reading → ✍️ Writing → 🗣️ Speaking · one continuous sitting
              </span>
              {!fullMock && (
                <span className="mt-1 block text-[11px] text-amber-300/80">
                  Not available for this exam — it is a section practice exam. Pick a single section below.
                </span>
              )}
            </span>
            {fullMock && (
              <span className="shrink-0 rounded-lg bg-brand px-3 py-1.5 text-xs font-bold text-black">Start</span>
            )}
          </button>
        </div>

        {/* Single section practice */}
        <div className="mt-5">
          <h3 className="text-xs font-bold uppercase tracking-widest text-white/40">Single section practice</h3>
          <ul className="mt-2 grid gap-2 sm:grid-cols-2">
            {sections.map(({ skill, enabled }) => (
              <li key={skill}>
                <button
                  type="button"
                  disabled={!enabled || busy}
                  onClick={() => onStart(singleSectionChoice(mode, skill))}
                  className="card flex w-full items-center gap-3 rounded-xl p-3.5 text-left transition enabled:hover:border-brand/25 disabled:opacity-40"
                >
                  <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-white/5 text-xl ring-1 ring-white/10">
                    {MOCK_SECTION_ICON[skill]}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-bold text-white">
                      {MOCK_SKILL_LABEL[skill]} Only
                    </span>
                    <span className="mt-0.5 block text-[11px] text-white/40">
                      {enabled ? `~${MOCK_SECTION_MINUTES[skill]} min` : "Not in this exam"}
                    </span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </div>

        {busy && (
          <p role="status" className="mt-4 text-xs text-white/50">
            Starting your attempt…
          </p>
        )}
        <p className="mt-4 text-[11px] leading-relaxed text-white/30">
          A single-section attempt is submitted on its own — the sections you did not choose are never required, and
          lockdown is released as soon as you submit.
        </p>
      </div>
    </div>
  );
}
