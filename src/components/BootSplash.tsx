import BestWayLogo3D from "./BestWayLogo3D";
import { ErrorBoundary } from "./common/ErrorBoundary";
import { hasWebGL } from "@/lib/webgl";

type Props = {
  /** When true, plays the quick exit transition (fade + scale). */
  exiting?: boolean;
  /** Override for tests; defaults to the WebGL probe. */
  webgl?: boolean;
};

/** Same wordmark as the pre-hydration screen in index.html — no WebGL needed. */
export function StaticLogo() {
  return (
    <div className="boot-fallback-static" data-testid="static-logo">
      <p className="boot-fallback-name">
        Best<span>Way</span>
      </p>
      <p className="boot-fallback-slogan">DO YOUR BEST, FOR GET THE REST</p>
    </div>
  );
}

/**
 * Branded intro for BestWay — exactly 2.5s total, plays ONCE on app open.
 *
 * Purely presentational — it never drives routing, auth, or data loading.
 * The parent shows it on a fixed timer and unmounts it at 2.5s,
 * regardless of how long session restore / network takes underneath.
 *
 * Just the animated 3D logo, centered and large on the dark brand backdrop.
 */
export default function BootSplash({ exiting = false, webgl }: Props) {
  const canRender3D = webgl ?? hasWebGL();
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
            {canRender3D ? (
              <ErrorBoundary fallback={<StaticLogo />}>
                <BestWayLogo3D
                  className="bw-logo-3d bw-logo-3d-solo"
                  glow={false}
                  particles={false}
                  style={{ width: "min(1100px, 94vw)", height: "auto", aspectRatio: "3 / 1" }}
                />
              </ErrorBoundary>
            ) : (
              <StaticLogo />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
