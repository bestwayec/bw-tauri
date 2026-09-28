import { MOCK_SKILL_LABEL, MOCK_SKILLS, type MockShapedSection, type MockSkill, type MockStartResult } from "@/lib/mocks";

type Props = {
  start: MockStartResult;
  onPick: (section: MockShapedSection) => void;
  onBack: () => void;
};

const SKILL_ICON: Record<MockSkill, string> = {
  listening: "🎧",
  reading: "📖",
  writing: "✍️",
  speaking: "🎙",
};

function fmtCountdown(iso: string | null | undefined, now: number): string | null {
  if (!iso) return null;
  const ms = new Date(iso).getTime() - now;
  if (!Number.isFinite(ms) || ms <= 0) return "time up";
  const total = Math.floor(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const mm = h > 0 ? String(m).padStart(2, "0") : String(m);
  return `${h > 0 ? `${h}:` : ""}${mm}:${String(s).padStart(2, "0")}`;
}

/**
 * Section picker for mock exams: choose Listening / Reading / Writing /
 * Speaking, then take that section alone (one group per page, Next button).
 * Only sections present in the shaped exam are enabled.
 */
export default function MockSectionPicker({ start, onPick, onBack }: Props) {
  const exam = start.exam;
  const timed = start.mode === "timed";
  const now = Date.now();
  const bySkill = new Map(exam.sections.map((s) => [s.skill, s]));

  return (
    <section className="mx-auto w-full max-w-3xl">
      <button
        type="button"
        onClick={onBack}
        className="rounded-lg px-2 py-1 text-xs font-semibold text-white/50 ring-1 ring-white/10 hover:text-white"
      >
        ← All exams
      </button>
      <p className="mt-3 text-[11px] font-semibold uppercase tracking-[0.2em] text-violet-300/70">
        {exam.type === "multilevel" ? "Multilevel mock" : "IELTS mock"} · {timed ? "Timed" : "Practice"}
      </p>
      <h1 className="mt-1 text-2xl font-black tracking-tight text-white">{exam.title}</h1>
      <p className="mt-1 text-sm text-white/50">
        Which section do you want to take? Each section is submitted separately.
      </p>

      <ul className="mt-5 grid gap-3 sm:grid-cols-2">
        {MOCK_SKILLS.map((skill) => {
          const section = bySkill.get(skill);
          const enabled = !!section && section.groups.length > 0;
          const groups = section?.groups.length ?? 0;
          const questions = section?.groups.reduce((s, g) => s + g.questions.length, 0) ?? 0;
          const deadlineLeft = timed ? fmtCountdown(start.sectionDeadlines?.[skill], now) : null;
          return (
            <li key={skill}>
              <button
                type="button"
                disabled={!enabled}
                onClick={() => section && onPick(section)}
                className="card group flex w-full items-center gap-4 rounded-2xl p-5 text-left transition enabled:hover:border-emerald-400/25 disabled:opacity-40"
              >
                <span className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-white/5 text-2xl ring-1 ring-white/10">
                  {SKILL_ICON[skill]}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-base font-bold text-white">
                    {MOCK_SKILL_LABEL[skill]}
                  </span>
                  <span className="mt-0.5 block text-[11px] text-white/40">
                    {enabled ? (
                      <>
                        {groups} part{groups === 1 ? "" : "s"} · {questions} question{questions === 1 ? "" : "s"}
                        {deadlineLeft != null && <> · ⏱ {deadlineLeft} left</>}
                        {skill === "speaking" && timed && <> · no time limit</>}
                      </>
                    ) : (
                      "Not in this exam"
                    )}
                  </span>
                </span>
                {enabled && <span className="shrink-0 text-lg text-white/30 transition group-enabled:group-hover:translate-x-0.5 group-enabled:group-hover:text-white">→</span>}
              </button>
            </li>
          );
        })}
      </ul>
      {timed && (
        <p className="mt-4 text-[11px] leading-relaxed text-white/30">
          Timed mode: Listening time comes from the audio length + 2 min review · Reading/Writing use a fixed
          countdown · Speaking has no time limit — submit when you finish.
        </p>
      )}
    </section>
  );
}
