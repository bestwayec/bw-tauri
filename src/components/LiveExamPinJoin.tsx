import { useState } from "react";
import { get, post } from "@/lib/api";
import { startMockExam, type MockExamListItem, type MockStartResult } from "@/lib/mocks";
import type { SimulatorMode } from "@/components/exam-ui/model";

export interface LiveRoomJoinResponse {
  roomId: string;
  pin: string;
  title: string;
  examId: string;
  simulatorMode: SimulatorMode;
  examType?: "ielts_academic" | "ielts_general" | "multilevel";
  status: "waiting" | "active" | "completed";
  attemptStart?: MockStartResult;
}

/** Validate that a Live Exam PIN is a 6-digit numeric code. */
export function isValidExamPin(pin: string): boolean {
  return /^\d{6}$/.test(pin.trim());
}

/** Sanitize user input into up to 6 numeric digits. */
export function sanitizeExamPinInput(raw: string): string {
  return raw.replace(/\D/g, "").slice(0, 6);
}

interface Props {
  onJoinedMock?: (mock: MockExamListItem, start: MockStartResult) => void;
  onNavigateExams?: () => void;
}

export default function LiveExamPinJoin({ onJoinedMock, onNavigateExams }: Props) {
  const [pin, setPin] = useState("");
  const [mode, setMode] = useState<SimulatorMode>("cdi");
  const [joining, setJoining] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [joinedRoom, setJoinedRoom] = useState<LiveRoomJoinResponse | null>(null);

  const valid = isValidExamPin(pin);

  async function handleJoin(e: React.FormEvent) {
    e.preventDefault();
    const cleaned = pin.trim();
    if (!isValidExamPin(cleaned)) {
      setError("Please enter a valid 6-digit numeric PIN code.");
      return;
    }
    setJoining(true);
    setError(null);
    try {
      let res: LiveRoomJoinResponse;
      try {
        res = await get<LiveRoomJoinResponse>(
          `/v1/live-room/join?pin=${encodeURIComponent(cleaned)}&simulatorMode=${encodeURIComponent(mode)}`
        );
      } catch {
        res = await post<LiveRoomJoinResponse>("/mock/live-rooms/join", {
          pin: cleaned,
          simulatorMode: mode,
        });
      }
      const resolvedMode: SimulatorMode = res.simulatorMode ?? mode;
      setJoinedRoom({ ...res, simulatorMode: resolvedMode });

      if (onJoinedMock && (res.attemptStart || res.examId)) {
        const startPayload =
          res.attemptStart ??
          (await startMockExam(res.examId, { mode: "timed", flow: "full_test" }));
        const shapedStart: MockStartResult = {
          ...startPayload,
          simulatorMode: resolvedMode,
        };
        const synthMock: MockExamListItem = {
          id: shapedStart.exam.id,
          type: shapedStart.exam.type,
          title: res.title || shapedStart.exam.title,
          description: shapedStart.exam.description,
          level: shapedStart.exam.level,
          isDemo: shapedStart.exam.isDemo,
          isPublished: true,
          skills: shapedStart.exam.sections.map((s) => s.skill),
          questionCount: shapedStart.exam.questionCount,
          durationMinutes: shapedStart.durationMinutes,
          price: 0,
          access: "granted",
        };
        onJoinedMock(synthMock, shapedStart);
      }
    } catch (err: unknown) {
      const msg =
        typeof err === "object" && err !== null && "message" in err && typeof (err as { message: unknown }).message === "string"
          ? (err as { message: string }).message
          : "Live room not found or PIN expired. Check with your invigilator.";
      setError(msg);
    } finally {
      setJoining(false);
    }
  }

  return (
    <div
      className="card rounded-2xl border border-violet-500/30 bg-gradient-to-br from-violet-950/25 via-[#141D2E] to-[#0B0F17] p-5 shadow-lg"
      aria-label="Join Live Exam Room by PIN"
    >
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <span className="inline-flex items-center gap-1.5 rounded-full border border-violet-400/40 bg-violet-500/15 px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-violet-300">
              <span className="h-1.5 w-1.5 animate-ping rounded-full bg-violet-400" />
              Live Classroom Exam
            </span>
            <span className="text-[11px] font-semibold text-white/45">CDI & DTM Simulator</span>
          </div>
          <h2 className="text-base font-extrabold text-white">
            Join Teacher&apos;s Live Exam Room via 6-Digit PIN
          </h2>
          <p className="text-xs text-white/50">
            Enter the 6-digit PIN displayed on your teacher&apos;s board to launch the synchronized lockdown exam.
          </p>
        </div>

        <form onSubmit={(e) => void handleJoin(e)} className="flex flex-wrap items-center gap-2.5">
          <div className="inline-flex rounded-xl border border-white/10 bg-black/40 p-1" role="group" aria-label="Simulator Mode">
            {(
              [
                { id: "cdi", label: "IELTS CDI" },
                { id: "dtm", label: "Multi-Level DTM" },
              ] as const
            ).map((m) => (
              <button
                key={m.id}
                type="button"
                onClick={() => setMode(m.id)}
                aria-pressed={mode === m.id}
                className={`rounded-lg px-2.5 py-1.5 text-xs font-bold transition ${
                  mode === m.id
                    ? "bg-violet-500 text-white shadow"
                    : "text-white/55 hover:text-white"
                }`}
              >
                {m.label}
              </button>
            ))}
          </div>

          <input
            type="text"
            inputMode="numeric"
            maxLength={6}
            value={pin}
            onChange={(e) => {
              setPin(sanitizeExamPinInput(e.target.value));
              if (error) setError(null);
            }}
            placeholder="000000"
            aria-label="6-digit room PIN"
            className="w-32 rounded-xl border border-white/15 bg-black/50 px-3.5 py-2 text-center font-mono text-base font-black tracking-[0.28em] text-white placeholder-white/25 focus:border-violet-400 focus:outline-none"
          />

          <button
            type="submit"
            disabled={!valid || joining}
            className="btn-brand rounded-xl px-5 py-2.5 text-xs font-bold disabled:opacity-50"
          >
            {joining ? "Joining…" : `Join ${mode.toUpperCase()} Room →`}
          </button>
        </form>
      </div>

      {error && (
        <p role="alert" className="mt-3 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300">
          {error}
        </p>
      )}

      {joinedRoom && (
        <div
          role="status"
          className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-emerald-500/35 bg-emerald-500/10 px-3.5 py-2.5 text-xs text-emerald-200"
        >
          <span>
            Connected to <strong>{joinedRoom.title}</strong> (PIN <strong className="font-mono">{joinedRoom.pin}</strong> ·{" "}
            {joinedRoom.simulatorMode.toUpperCase()} mode)
          </span>
          {onNavigateExams && (
            <button
              type="button"
              onClick={onNavigateExams}
              className="rounded-lg bg-emerald-500 px-3 py-1 font-bold text-black hover:bg-emerald-400"
            >
              Open Exam →
            </button>
          )}
        </div>
      )}
    </div>
  );
}
