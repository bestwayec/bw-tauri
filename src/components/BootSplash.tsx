type Props = {
  /** When true, plays the quick exit transition (fade + scale). */
  exiting?: boolean;
};

/**
 * Branded intro for BestWay — exactly 2.5s total, plays ONCE on app open.
 *
 * Purely presentational — it never drives routing, auth, or data loading.
 * The parent shows it on a fixed timer and unmounts it at 2.5s,
 * regardless of how long session restore / network takes underneath.
 *
 * Compressed sequence:
 *  0.0s ambient glow → 0.15–0.75s logo sharpens with glow →
 *  0.5–1.4s rings + single pulses → 0.9–1.6s brand + slogan →
 *  2.2–2.5s exit fade/scale into the app.
 */
export default function BootSplash({ exiting = false }: Props) {
  return (
    <div
      className={`bw-boot${exiting ? " is-exiting" : ""}`}
      role="status"
      aria-live="polite"
      aria-label="Loading BestWay"
    >
      {/* Ambient background layers */}
      <div className="bw-boot-bg" aria-hidden="true">
        <div className="bw-ambient-core" />
        <div className="bw-ambient-drift" />
        <div className="bw-particles">
          {PARTICLES.map((p) => (
            <span
              key={p.id}
              className="bw-particle"
              style={{ left: p.left, top: p.top, width: p.size, height: p.size }}
            />
          ))}
        </div>
        <div className="bw-vignette" />
      </div>

      {/* Center composition */}
      <div className="bw-boot-inner">
        <div className="bw-logo-stage" aria-hidden="true">
          <div className="bw-halo" />
          <div className="bw-burst" />
          {/* Single elegant energy pulses (run once, staggered) */}
          <div className="bw-pulse bw-pulse-a" />
          <div className="bw-pulse bw-pulse-b" />
          {/* Thin elegant rotating energy rings */}
          <div className="bw-ring bw-ring-outer" />
          <div className="bw-ring bw-ring-mid" />
          <div className="bw-orbit">
            <span className="bw-orbit-dot" />
          </div>

          <div className="bw-logo-breathe">
            <div className="bw-logo-enter">
              <div className="bw-logo-glow" />
              <div className="bw-logo-box">
                <img
                  className="bw-logo-img"
                  src="/logo-transparent.png"
                  alt="BestWay"
                  draggable={false}
                />
              </div>
            </div>
          </div>
        </div>

        <p className="bw-brand">
          Best<span className="bw-brand-thin">Way</span>
        </p>
        <p className="bw-slogan">DO YOUR BEST, FOR GET THE REST</p>
      </div>
    </div>
  );
}

/**
 * Deterministic particle field — fixed positions so every paint is identical
 * (no hydration flicker, no re-roll on re-render). Kept dim and static on
 * purpose: the background must support the logo, never compete with it.
 */
const PARTICLES: Array<{
  id: number;
  left: string;
  top: string;
  size: number;
}> = [
  { id: 0, left: "18%", top: "28%", size: 2 },
  { id: 1, left: "26%", top: "68%", size: 2 },
  { id: 2, left: "33%", top: "38%", size: 3 },
  { id: 3, left: "41%", top: "22%", size: 2 },
  { id: 4, left: "47%", top: "74%", size: 2 },
  { id: 5, left: "54%", top: "30%", size: 2 },
  { id: 6, left: "60%", top: "62%", size: 3 },
  { id: 7, left: "66%", top: "40%", size: 2 },
  { id: 8, left: "72%", top: "70%", size: 2 },
  { id: 9, left: "78%", top: "30%", size: 2 },
  { id: 10, left: "22%", top: "52%", size: 2 },
  { id: 11, left: "38%", top: "58%", size: 2 },
  { id: 12, left: "58%", top: "20%", size: 2 },
  { id: 13, left: "63%", top: "78%", size: 2 },
  { id: 14, left: "30%", top: "80%", size: 2 },
  { id: 15, left: "75%", top: "52%", size: 3 },
];
