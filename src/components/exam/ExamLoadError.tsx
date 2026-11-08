type Props = {
  /** Technical detail (error code, counts) shown in small print for support. */
  detail?: string | null;
  retrying?: boolean;
  onRetry: () => void;
  onBack: () => void;
};

/**
 * The one error card for a section whose questions did not arrive (server
 * returned an empty section, the request failed, or no cached copy exists).
 * Replaces the bare "Failed to load questions from server (0/0)" message.
 */
export default function ExamLoadError({ detail, retrying = false, onRetry, onBack }: Props) {
  return (
    <section
      role="alert"
      aria-labelledby="exam-load-error-title"
      className="mx-auto my-10 flex w-full max-w-lg flex-col items-center rounded-2xl border border-red-500/25 bg-red-950/20 p-6 text-center text-slate-200"
    >
      <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-red-500/10 text-red-400" aria-hidden="true">
        <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
        </svg>
      </div>
      <h2 id="exam-load-error-title" className="text-base font-semibold text-red-100">
        Savollarni yuklab bo&apos;lmadi
      </h2>
      <p className="mt-2 max-w-md text-sm text-red-200/80">
        Bu bo&apos;lim savollari serverdan kelmadi. Internet aloqasini tekshirib, qayta urinib ko&apos;ring. Muammo
        takrorlansa, nazoratchiga xabar bering.
      </p>
      {detail && <p className="mt-2 text-[11px] text-red-300/60">{detail}</p>}
      <div className="mt-5 flex gap-3">
        <button
          type="button"
          onClick={onRetry}
          disabled={retrying}
          className="rounded-lg bg-red-600/80 px-4 py-2 text-sm font-semibold text-white transition hover:bg-red-600 disabled:opacity-60"
        >
          {retrying ? "Yuklanmoqda…" : "Qayta urinish"}
        </button>
        <button
          type="button"
          onClick={onBack}
          disabled={retrying}
          className="rounded-lg border border-white/15 px-4 py-2 text-sm font-semibold text-white/80 transition hover:bg-white/5 disabled:opacity-60"
        >
          Orqaga
        </button>
      </div>
    </section>
  );
}
