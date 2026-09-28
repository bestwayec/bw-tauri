type Props = {
  onBack: () => void;
};

export default function Locked({ onBack }: Props) {
  return (
    <section className="flex h-full items-center justify-center p-6">
      <div className="card w-full max-w-md rounded-2xl p-8 text-center">
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full border border-red-500/40 bg-red-500/10 text-xl">
          🔒
        </div>
        <h1 className="mt-3 text-xl font-bold tracking-tight">Locked</h1>
        <p className="mt-1 text-sm text-white/50">
          Session locked (e.g. focus/battery policy). Contact supervisor.
        </p>
        {/* TODO: reflect lock state from backend /v1/tests+mock contract session status; online-only. */}
        <button
          onClick={onBack}
          className="btn-ghost mt-5 w-full rounded-xl px-4 py-2.5 text-sm text-white"
        >
          Back to exams
        </button>
      </div>
    </section>
  );
}
