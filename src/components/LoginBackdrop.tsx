import { Suspense, lazy } from "react";
import { ErrorBoundary } from "./common/ErrorBoundary";
import { isLowEndSystem } from "@/lib/device-capability";

const Particles = lazy(() => import("./Particles"));

type Props = {
  /** Result of the WebGL probe; without WebGL only the static gradient shows. */
  webgl: boolean;
  reduceMotion: boolean;
};

/**
 * Decorative particle field behind the login card. It is optional: no WebGL,
 * reduced motion, low-memory 4GB PC, or a crash inside ogl all leave the login form usable on
 * the plain dark background, avoiding excessive idle CPU usage.
 */
export default function LoginBackdrop({ webgl, reduceMotion }: Props) {
  if (!webgl || reduceMotion || isLowEndSystem()) return null;
  return (
    <div
      aria-hidden="true"
      className="pointer-events-none absolute inset-0 opacity-85 [mask-image:radial-gradient(ellipse_85%_75%_at_50%_45%,black_30%,transparent_100%)]"
    >
      <ErrorBoundary fallback={null}>
        <Suspense fallback={null}>
          <Particles
            particleCount={220}
            particleSpread={10}
            speed={0.15}
            particleColors={["#10B981", "#34D399", "#059669"]}
            alphaParticles
            particleBaseSize={150}
            sizeRandomness={0.8}
            cameraDistance={20}
          />
        </Suspense>
      </ErrorBoundary>
    </div>
  );
}
