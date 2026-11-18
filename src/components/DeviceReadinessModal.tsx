import { useEffect, useRef, useState } from "react";
import { API_BASE_URL } from "@/lib/api";
import { audioCaptureFailure, audioCaptureSupported, openMicrophone } from "@/lib/audio-capture";
import { getVolume, setVolume } from "@/lib/volume";
import { APP_VERSION } from "@/lib/version";

interface Props {
  open: boolean;
  onClose: () => void;
  onProceed?: () => void;
  requireCamera?: boolean;
}

type CheckStatus = "pending" | "checking" | "pass" | "warn" | "fail";

export default function DeviceReadinessModal({
  open,
  onClose,
  onProceed,
  requireCamera = false,
}: Props) {
  // 1. Connectivity
  const [networkStatus, setNetworkStatus] = useState<CheckStatus>("pending");
  const [latencyMs, setLatencyMs] = useState<number | null>(null);

  // 2. Audio Output
  const [audioHeard, setAudioHeard] = useState(false);
  const [playingChime, setPlayingChime] = useState(false);
  const [volume, setVolState] = useState(() => getVolume());

  // 3. Microphone
  const [micStatus, setMicStatus] = useState<CheckStatus>("pending");
  const [micError, setMicError] = useState<string | null>(null);
  const [micLevel, setMicLevel] = useState(0);
  const [micTesting, setMicTesting] = useState(false);

  // 4. Camera (Optional / Proctoring)
  const [cameraStatus, setCameraStatus] = useState<CheckStatus>("pending");
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [cameraActive, setCameraActive] = useState(false);

  // 5. Storage
  const [storageStatus, setStorageStatus] = useState<CheckStatus>("pending");
  const [storageAvailableMb, setStorageAvailableMb] = useState<number | null>(null);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const micStreamRef = useRef<MediaStream | null>(null);
  const cameraStreamRef = useRef<MediaStream | null>(null);
  const animFrameRef = useRef<number | null>(null);

  function cleanupStreams() {
    if (animFrameRef.current !== null) {
      cancelAnimationFrame(animFrameRef.current);
      animFrameRef.current = null;
    }
    if (micStreamRef.current) {
      micStreamRef.current.getTracks().forEach((t) => t.stop());
      micStreamRef.current = null;
    }
    if (cameraStreamRef.current) {
      cameraStreamRef.current.getTracks().forEach((t) => t.stop());
      cameraStreamRef.current = null;
    }
    setMicTesting(false);
    setCameraActive(false);
  }

  useEffect(() => {
    if (!open) {
      cleanupStreams();
      return;
    }

    // Auto-run non-intrusive checks on mount
    void checkNetwork();
    void checkStorage();

    return () => {
      cleanupStreams();
    };
  }, [open]);

  // 1. Network Latency Check
  async function checkNetwork() {
    setNetworkStatus("checking");
    const start = performance.now();
    try {
      const res = await fetch(`${API_BASE_URL}/auth/me`, {
        method: "GET",
        headers: { "Cache-Control": "no-cache" },
      });
      const elapsed = Math.round(performance.now() - start);
      setLatencyMs(elapsed);
      if (res.status < 500) {
        setNetworkStatus(elapsed > 800 ? "warn" : "pass");
      } else {
        setNetworkStatus("warn");
      }
    } catch {
      const elapsed = Math.round(performance.now() - start);
      setLatencyMs(elapsed);
      setNetworkStatus(navigator.onLine ? "warn" : "fail");
    }
  }

  // 2. Audio Chime Playback
  function playTestChime() {
    setPlayingChime(true);
    try {
      const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!AudioCtx) {
        setPlayingChime(false);
        return;
      }
      const ctx = new AudioCtx();
      const now = ctx.currentTime;
      const gain = ctx.createGain();
      gain.gain.setValueAtTime((volume / 100) * 0.3, now);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 1.2);
      gain.connect(ctx.destination);

      // Play C5 (523.25 Hz) followed by E5 (659.25 Hz)
      const osc1 = ctx.createOscillator();
      osc1.type = "sine";
      osc1.frequency.setValueAtTime(523.25, now);
      osc1.connect(gain);
      osc1.start(now);
      osc1.stop(now + 0.5);

      const osc2 = ctx.createOscillator();
      osc2.type = "sine";
      osc2.frequency.setValueAtTime(659.25, now + 0.3);
      osc2.connect(gain);
      osc2.start(now + 0.3);
      osc2.stop(now + 1.2);

      osc2.onended = () => {
        void ctx.close().catch(() => undefined);
        setPlayingChime(false);
      };
    } catch {
      setPlayingChime(false);
    }
  }

  function handleVolumeChange(v: number) {
    setVolState(v);
    setVolume(v);
  }

  // 3. Microphone Check
  async function testMicrophone() {
    if (!audioCaptureSupported()) {
      setMicStatus("fail");
      setMicError("Microphone API is not supported on this device.");
      return;
    }
    setMicStatus("checking");
    setMicError(null);
    setMicTesting(true);

    try {
      const stream = await openMicrophone();
      micStreamRef.current = stream;
      setMicStatus("pass");

      const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (AudioCtx) {
        const ctx = new AudioCtx();
        const source = ctx.createMediaStreamSource(stream);
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 256;
        source.connect(analyser);

        const dataArray = new Uint8Array(analyser.frequencyBinCount);
        const poll = () => {
          if (!micStreamRef.current) {
            void ctx.close().catch(() => undefined);
            return;
          }
          analyser.getByteFrequencyData(dataArray);
          let sum = 0;
          for (let i = 0; i < dataArray.length; i++) sum += dataArray[i];
          const avg = sum / dataArray.length;
          setMicLevel(Math.min(100, Math.round((avg / 128) * 100)));
          animFrameRef.current = requestAnimationFrame(poll);
        };
        poll();
      }
    } catch (e) {
      setMicStatus("fail");
      setMicError(audioCaptureFailure(e));
      setMicTesting(false);
    }
  }

  // 4. Camera Check
  async function testCamera() {
    setCameraStatus("checking");
    setCameraError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: 640 }, height: { ideal: 480 } },
        audio: false,
      });
      cameraStreamRef.current = stream;
      setCameraStatus("pass");
      setCameraActive(true);
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        void videoRef.current.play().catch(() => undefined);
      }
    } catch {
      setCameraStatus("warn");
      setCameraError("Camera unavailable or permission denied. (Optional for standard exams)");
      setCameraActive(false);
    }
  }

  // 5. Storage Check
  async function checkStorage() {
    setStorageStatus("checking");
    try {
      if (navigator.storage && typeof navigator.storage.estimate === "function") {
        const estimate = await navigator.storage.estimate();
        const availableBytes = (estimate.quota ?? 0) - (estimate.usage ?? 0);
        const availableMb = Math.round(availableBytes / (1024 * 1024));
        setStorageAvailableMb(availableMb);
        setStorageStatus(availableMb > 50 ? "pass" : "warn");
      } else {
        setStorageAvailableMb(500); // Standard web storage quota fallback
        setStorageStatus("pass");
      }
    } catch {
      setStorageStatus("pass");
    }
  }

  if (!open) return null;

  const isAllReady =
    networkStatus !== "fail" &&
    audioHeard &&
    micStatus === "pass" &&
    (!requireCamera || cameraStatus === "pass");

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Device Readiness Center"
      className="fixed inset-0 z-[80] grid place-items-center bg-black/85 p-4 backdrop-blur-md animate-fade-in"
    >
      <div className="card w-full max-w-xl rounded-2xl border border-emerald-500/25 bg-[#0B0F17] p-6 shadow-2xl text-white">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-white/10 pb-4">
          <div className="flex items-center gap-3">
            <span className="grid size-10 place-items-center rounded-xl bg-emerald-500/15 border border-emerald-500/30 text-emerald-400 text-lg">
              🛡️
            </span>
            <div>
              <h2 className="text-base font-bold text-white">Device Readiness Center</h2>
              <p className="text-xs text-slate-400">
                Imtihondan oldin audio, mikrofon va tarmoq sozlamalarini tekshiring
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1 text-slate-400 hover:bg-white/10 hover:text-white transition-colors"
            aria-label="Close"
          >
            ✕
          </button>
        </div>

        {/* Diagnostic Items Grid */}
        <div className="mt-4 space-y-3.5 max-h-[60vh] overflow-y-auto pr-1">
          {/* 1. Network & Backend Connectivity */}
          <div className="rounded-xl border border-white/5 bg-[#111827] p-3.5 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <span className="text-lg">🌐</span>
              <div>
                <p className="text-xs font-semibold text-white">Tarmoq va Server Aloqasi (Connectivity)</p>
                <p className="text-[11px] text-slate-400 font-mono">
                  {latencyMs != null ? `Server kechikishi (Latency): ${latencyMs} ms` : "Checking latency…"}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <span
                className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider ${
                  networkStatus === "pass"
                    ? "bg-emerald-500/20 text-emerald-300 border border-emerald-500/30"
                    : networkStatus === "warn"
                    ? "bg-amber-500/20 text-amber-300 border border-amber-500/30"
                    : "bg-red-500/20 text-red-300 border border-red-500/30"
                }`}
              >
                {networkStatus === "pass" ? "Aloqa barqaror" : networkStatus === "warn" ? "Kechikish yuqori" : "Aloqa yo'q"}
              </span>
              <button
                type="button"
                onClick={() => void checkNetwork()}
                className="text-[11px] text-emerald-400 hover:underline"
              >
                Qayta
              </button>
            </div>
          </div>

          {/* 2. Audio Output / Headphone Test */}
          <div className="rounded-xl border border-white/5 bg-[#111827] p-3.5">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <span className="text-lg">🎧</span>
                <div>
                  <p className="text-xs font-semibold text-white">Audio va Quloqchin (Sound Output)</p>
                  <p className="text-[11px] text-slate-400">
                    Listening ovozini eshitishingizni tasdiqlang
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={playTestChime}
                disabled={playingChime}
                className="btn-brand px-3 py-1 rounded-lg text-xs font-semibold"
              >
                {playingChime ? "Chalinmoqda…" : "▶ Sinov ovozi (Play Chime)"}
              </button>
            </div>

            <div className="mt-3 flex items-center justify-between gap-4 border-t border-white/5 pt-2.5">
              <div className="flex items-center gap-2 text-xs text-slate-300">
                <span>Ovoz balandligi:</span>
                <input
                  type="range"
                  min={0}
                  max={100}
                  value={volume}
                  onChange={(e) => handleVolumeChange(Number(e.target.value))}
                  className="w-24 accent-emerald-500 cursor-pointer"
                />
                <span className="font-mono text-[11px] text-slate-400">{volume}%</span>
              </div>
              <label className="flex items-center gap-2 text-xs text-slate-200 cursor-pointer">
                <input
                  type="checkbox"
                  checked={audioHeard}
                  onChange={(e) => setAudioHeard(e.target.checked)}
                  className="rounded border-slate-700 bg-slate-900 text-emerald-500 focus:ring-0 cursor-pointer"
                />
                <span className="text-[11px]">Ovozni aniq eshitdim</span>
              </label>
            </div>
          </div>

          {/* 3. Microphone Input Test */}
          <div className="rounded-xl border border-white/5 bg-[#111827] p-3.5">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <span className="text-lg">🎙️</span>
                <div>
                  <p className="text-xs font-semibold text-white">Mikrofon (Speaking Microphone)</p>
                  <p className="text-[11px] text-slate-400">
                    Speaking javoblari uchun mikrofon sezuvchanligini tekshiring
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => void testMicrophone()}
                disabled={micTesting}
                className="btn-brand px-3 py-1 rounded-lg text-xs font-semibold"
              >
                {micTesting ? "Tekshirilmoqda…" : "🎙️ Mikrofonni tekshirish"}
              </button>
            </div>

            {micTesting && (
              <div className="mt-3 border-t border-white/5 pt-2.5">
                <p className="text-[11px] text-slate-400 mb-1">
                  Mikrofonga gapiring — signal darajasini kuzating:
                </p>
                <div className="h-2 w-full bg-slate-800 rounded-full overflow-hidden border border-white/5">
                  <div
                    className="h-full bg-emerald-500 transition-all duration-75 rounded-full"
                    style={{ width: `${micLevel}%` }}
                  />
                </div>
              </div>
            )}

            {micError && (
              <p className="mt-2 text-[11px] text-red-400 border border-red-500/20 bg-red-500/10 p-2 rounded-lg">
                ⚠️ {micError}
              </p>
            )}
          </div>

          {/* 4. Camera (Optional / Proctoring) */}
          <div className="rounded-xl border border-white/5 bg-[#111827] p-3.5">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <span className="text-lg">📷</span>
                <div>
                  <p className="text-xs font-semibold text-white">
                    Veb-kamera (Camera) <span className="text-slate-500 text-[10px] font-normal">(Ixtiyoriy)</span>
                  </p>
                  <p className="text-[11px] text-slate-400">
                    Proctoring nazorati talab qilinganda ishlatiladi
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => void testCamera()}
                className="rounded-lg border border-slate-700 bg-slate-800 px-3 py-1 text-xs font-semibold text-slate-300 hover:bg-slate-700 hover:text-white transition-colors"
              >
                {cameraActive ? "Kamera faol" : "Kamerani sinash"}
              </button>
            </div>

            {cameraActive && (
              <div className="mt-3 border-t border-white/5 pt-2.5">
                <video
                  ref={videoRef}
                  className="w-full max-h-36 rounded-lg bg-black object-cover border border-white/10"
                  muted
                  playsInline
                />
              </div>
            )}

            {cameraError && (
              <p className="mt-2 text-[11px] text-amber-400/90 border border-amber-500/20 bg-amber-500/10 p-2 rounded-lg">
                ℹ️ {cameraError}
              </p>
            )}
          </div>

          {/* 5. Storage & Version Info */}
          <div className="rounded-xl border border-white/5 bg-[#111827] p-3 flex items-center justify-between text-xs text-slate-400 font-mono">
            <span>💾 Disk Quota: ~{storageAvailableMb ?? 500} MB ({storageStatus === "pass" ? "OK" : "Low"})</span>
            <span>App: v{APP_VERSION} (Tauri v2)</span>
          </div>
        </div>

        {/* Summary & Action Buttons */}
        <div className="mt-5 flex items-center justify-between border-t border-white/10 pt-4">
          <div className="flex items-center gap-2">
            <span
              className={`size-2.5 rounded-full ${
                isAllReady ? "bg-emerald-400 shadow-[0_0_8px_#34d399]" : "bg-amber-400 shadow-[0_0_8px_#fbbf24]"
              }`}
            />
            <span className="text-xs font-semibold text-slate-300">
              {isAllReady
                ? "Barcha zarur tizimlar imtihonga tayyor"
                : "Iltimos, yuqoridagi audio va mikrofon sinovini tasdiqlang"}
            </span>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-xl border border-slate-700 bg-slate-800/80 px-4 py-2 text-xs font-semibold text-slate-300 hover:bg-slate-700 hover:text-white transition-colors"
            >
              Yopish
            </button>
            {onProceed && (
              <button
                type="button"
                onClick={() => {
                  onClose();
                  onProceed();
                }}
                disabled={!isAllReady}
                className={`btn-brand rounded-xl px-5 py-2 text-xs font-bold transition-all ${
                  isAllReady
                    ? "shadow-lg shadow-emerald-950/40"
                    : "opacity-40 cursor-not-allowed hover:brightness-100"
                }`}
              >
                Imtihonni boshlash →
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
