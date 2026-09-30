import BestWayLogo3D from "./BestWayLogo3D";

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
 * Just the animated 3D logo, centered and large on the dark brand backdrop.
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
        <div className="bw-vignette" />
      </div>

      {/* Center composition: 3D logo only */}
      <div className="bw-boot-inner bw-boot-inner-solo">
        <div className="bw-logo-breathe">
          <div className="bw-logo-enter">
            <BestWayLogo3D
              className="bw-logo-3d bw-logo-3d-solo"
              glow={false}
              particles={false}
              style={{ width: "min(1100px, 94vw)", height: "auto", aspectRatio: "3 / 1" }}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
