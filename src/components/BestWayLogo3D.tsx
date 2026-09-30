import { useMemo, useRef, type CSSProperties } from "react";
import * as THREE from "three";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import rawLogo from "./bestway-logo-data.json";

/**
 * Best Way – animated 3D loading logo (vector shapes extruded with three.js).
 *
 * Vector source: `bestway-logo-data.json` (kept next to this file).
 * The canvas is transparent — put any background behind it.
 *
 * Props: glow, particles, className, style.
 * The parent must give this component an explicit height (it fills 100%).
 *
 * Deliberately cursor-proof: pointer input is never read, so mouse movement
 * cannot tilt or shift the logo — it stays locked dead-center.
 */

interface LogoShape {
  /** Present + truthy on solid body pieces; absent on flush inlays. */
  b?: number;
  c: string;
  /** First ring = outline, rest = holes (flat [x,y,…] pairs). */
  p: number[][];
}

interface LogoPieceData {
  id: string;
  px: number;
  py: number;
  /** Extrusion depth in logo pixel units. */
  D: number;
  /** Inlay relief in logo pixel units. */
  rel: number;
  /** Optional 3x3 linear colour-gradient fit. */
  gr?: number[][];
  s: LogoShape[];
}

const LOGO = rawLogo as unknown as LogoPieceData[];

const S = 0.0085; // logo pixel units -> scene units

function clamp(v: number, a: number, b: number): number {
  return Math.min(b, Math.max(a, v));
}

function ease(t: number): number {
  return 1 - Math.pow(1 - t, 4);
}

function pts2(p: number[]): THREE.Vector2[] {
  const a: THREE.Vector2[] = [];
  for (let i = 0; i < p.length; i += 2) a.push(new THREE.Vector2(p[i], p[i + 1]));
  return a;
}

interface BuiltMesh {
  geo: THREE.ExtrudeGeometry;
  mat: THREE.Material;
  z: number;
}

interface BuiltPart {
  id: string;
  px: number;
  py: number;
  meshes: BuiltMesh[];
}

// Build every logo piece once: solid extruded body + flush inlays (no gaps).
function buildParts(): BuiltPart[] {
  return LOGO.map((L) => {
    const D = L.D;
    const bt = D * 0.08;
    const front = D / 2 + bt;
    const rel = L.rel ?? 0;
    const meshes = L.s.map((s) => {
      const shape = new THREE.Shape(pts2(s.p[0]));
      for (let h = 1; h < s.p.length; h++) shape.holes.push(new THREE.Path(pts2(s.p[h])));

      if (s.b) {
        const geo = new THREE.ExtrudeGeometry(shape, {
          depth: D,
          bevelEnabled: true,
          bevelThickness: bt,
          bevelSize: 0.6,
          bevelSegments: 3,
          curveSegments: 1,
        });
        let mat: THREE.Material;
        if (L.gr) {
          // linear colour gradient fitted to the original logo colours
          const pos = geo.attributes.position as THREE.BufferAttribute;
          const col = new Float32Array(pos.count * 3);
          const g = L.gr;
          const c = new THREE.Color();
          for (let i = 0; i < pos.count; i++) {
            const x = pos.getX(i);
            const y = pos.getY(i);
            c.setRGB(
              clamp((g[0][0] + g[1][0] * x + g[2][0] * y) / 255, 0, 1),
              clamp((g[0][1] + g[1][1] * x + g[2][1] * y) / 255, 0, 1),
              clamp((g[0][2] + g[1][2] * x + g[2][2] * y) / 255, 0, 1),
              THREE.SRGBColorSpace,
            );
            col.set([c.r, c.g, c.b], i * 3);
          }
          geo.setAttribute("color", new THREE.BufferAttribute(col, 3));
          mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.42, metalness: 0.1 });
        } else {
          mat = new THREE.MeshStandardMaterial({ color: s.c, roughness: 0.45, metalness: 0.08 });
        }
        return { geo, mat, z: -D / 2 };
      }
      // inlay: pressed 1 unit into the body and proud by rel -> cannot leave a gap
      const dep = rel + bt + 1;
      const geo = new THREE.ExtrudeGeometry(shape, { depth: dep, bevelEnabled: false, curveSegments: 1 });
      const mat = new THREE.MeshStandardMaterial({ color: s.c, roughness: 0.35, metalness: 0.05 });
      return { geo, mat, z: front + rel - dep };
    });
    return { id: L.id, px: L.px * S, py: L.py * S, meshes };
  });
}

interface ArtworkFit {
  /** Scene-unit center of the artwork (for true centering). */
  cx: number;
  cy: number;
  /** Scene-unit fit size with breathing margin (logo is wide and short). */
  fitW: number;
  fitH: number;
}

// Measure the real vector bounds once: pieces carry px/py offsets and the
// composition is NOT centered on the origin, so frame from data, not guesswork.
function measureArtwork(): ArtworkFit {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const L of LOGO) {
    for (const s of L.s) {
      for (const ring of s.p) {
        for (let i = 0; i < ring.length; i += 2) {
          const x = L.px + ring[i];
          const y = L.py + ring[i + 1];
          if (x < x0) x0 = x;
          if (x > x1) x1 = x;
          if (y < y0) y0 = y;
          if (y > y1) y1 = y;
        }
      }
    }
  }
  const w = (x1 - x0) * S;
  const h = (y1 - y0) * S;
  return {
    cx: ((x0 + x1) / 2) * S,
    cy: ((y0 + y1) / 2) * S,
    fitW: w * 1.05,
    fitH: h * 1.17,
  };
}

function makeGlowTexture(): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = c.height = 256;
  const x = c.getContext("2d");
  if (x) {
    const g = x.createRadialGradient(128, 128, 0, 128, 128, 128);
    g.addColorStop(0, "rgba(140,220,90,.5)");
    g.addColorStop(0.5, "rgba(60,160,80,.14)");
    g.addColorStop(1, "rgba(0,0,0,0)");
    x.fillStyle = g;
    x.fillRect(0, 0, 256, 256);
  }
  return new THREE.CanvasTexture(c);
}

function makeDotTexture(): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = c.height = 32;
  const x = c.getContext("2d");
  if (x) {
    const g = x.createRadialGradient(16, 16, 0, 16, 16, 16);
    g.addColorStop(0, "#fff");
    g.addColorStop(1, "rgba(255,255,255,0)");
    x.fillStyle = g;
    x.fillRect(0, 0, 32, 32);
  }
  return new THREE.CanvasTexture(c);
}

interface SceneProps {
  glow: boolean;
  particles: boolean;
}

function Scene({ glow, particles }: SceneProps) {
  const parts = useMemo(buildParts, []);
  const fit = useMemo(measureArtwork, []);
  const glowTex = useMemo(makeGlowTexture, []);
  const dotTex = useMemo(makeDotTexture, []);
  const N = 220;
  const { positions, speeds } = useMemo(() => {
    const positions = new Float32Array(N * 3);
    const speeds = new Float32Array(N);
    for (let i = 0; i < N; i++) {
      positions.set([(Math.random() - 0.5) * 15, (Math.random() - 0.5) * 8, (Math.random() - 0.5) * 5 - 2], i * 3);
      speeds[i] = 0.1 + Math.random() * 0.35;
    }
    return { positions, speeds };
  }, []);

  const root = useRef<THREE.Group | null>(null);
  const rim = useRef<THREE.PointLight | null>(null);
  const glowRef = useRef<THREE.Mesh | null>(null);
  const pointsRef = useRef<THREE.Points | null>(null);
  const pieces = useRef<Record<string, THREE.Group>>({});
  const { size } = useThree();

  useFrame((state) => {
    const t = state.clock.elapsedTime;
    const it = (a: number, d: number) => ease(clamp((t - a) / d, 0, 1));

    // Frame the measured artwork tightly (no empty box around it) and keep
    // its true middle at the origin on any aspect ratio.
    const aspect = size.width / size.height;
    const tanHalf = Math.tan((17.5 * Math.PI) / 180);
    state.camera.position.z = Math.max(
      fit.fitW / aspect / (2 * tanHalf),
      fit.fitH / (2 * tanHalf),
    );

    const rootObj = root.current;
    const rimObj = rim.current;
    if (!rootObj || !rimObj) return;

    // Locked dead-center: cursor input is never read — no tilt, no sway,
    // no bob. Only the entrance choreography below moves (cube pop, arc
    // draw, wings fly-in, all one-shot).
    rootObj.rotation.y = 0;
    rootObj.rotation.x = 0;
    rootObj.position.x = -fit.cx;
    rootObj.position.y = -fit.cy;
    rimObj.position.set(Math.cos(t * 0.8) * 5, Math.sin(t * 0.6) * 3, 4);
    if (glowRef.current) glowRef.current.scale.setScalar(1 + Math.sin(t * 1.3) * 0.06);

    const p = pieces.current;
    if (p.cube) {
      const s = it(0.1, 1.5);
      p.cube.scale.setScalar(0.01 + s * 0.99);
      p.cube.rotation.y = (1 - s) * Math.PI * 2 + Math.sin(t * 0.9) * 0.04;
    }
    if (p.arc) {
      const s = it(0.7, 1.4);
      p.arc.scale.setScalar(0.6 + 0.4 * s);
      p.arc.rotation.z = (1 - s) * -1.2;
      p.arc.visible = s > 0.01;
    }
    for (const sd of ["L", "R"]) {
      for (let k = 1; k <= 3; k++) {
        const w = p[sd + k];
        if (!w) continue;
        const dir = sd === "L" ? 1 : -1;
        const s = it(1 + k * 0.18, 1.6);
        const ph = t * 1.6 - k * 0.5;
        w.rotation.z = dir * (Math.sin(ph) * (0.04 + 0.015 * k) + (1 - s) * (k === 1 ? 0.3 : -0.3));
        w.rotation.y = dir * (1 - s) * 1.4;
        w.position.x = w.userData.home as number - dir * (1 - s) * 3;
        w.scale.setScalar(0.4 + 0.6 * s);
        w.visible = s > 0.005;
      }
    }

    if (pointsRef.current) {
      const attr = pointsRef.current.geometry.getAttribute("position") as THREE.BufferAttribute;
      for (let i = 0; i < N; i++) {
        let y = attr.getY(i) + speeds[i] * 0.006;
        if (y > 4.2) y = -4.2;
        attr.setY(i, y);
      }
      attr.needsUpdate = true;
      pointsRef.current.rotation.y = t * 0.02;
    }
  });

  return (
    <>
      <ambientLight intensity={2.05} />
      <directionalLight intensity={1.7} position={[2, 3, 8]} />
      <pointLight ref={rim} color="#c8ff9a" intensity={2.2} distance={30} decay={0} />

      <group ref={root}>
        {parts.map((part) => (
          <group
            key={part.id}
            position={[part.px, part.py, 0]}
            userData={{ home: part.px }}
            ref={(g) => {
              if (g) pieces.current[part.id] = g;
            }}
          >
            <group scale={S}>
              {part.meshes.map((m, i) => (
                <mesh key={i} geometry={m.geo} material={m.mat} position-z={m.z} />
              ))}
            </group>
          </group>
        ))}
      </group>

      {glow && (
        <mesh ref={glowRef} position={[0, 0, -1.5]}>
          <planeGeometry args={[10, 10]} />
          <meshBasicMaterial map={glowTex} transparent depthWrite={false} blending={THREE.AdditiveBlending} />
        </mesh>
      )}

      {particles && (
        <points ref={pointsRef}>
          <bufferGeometry>
            <bufferAttribute attach="attributes-position" args={[positions, 3]} />
          </bufferGeometry>
          <pointsMaterial
            size={0.07}
            map={dotTex}
            transparent
            opacity={0.55}
            depthWrite={false}
            color="#b8f08a"
            blending={THREE.AdditiveBlending}
          />
        </points>
      )}
    </>
  );
}

export interface BestWayLogo3DProps {
  glow?: boolean;
  particles?: boolean;
  className?: string;
  style?: CSSProperties;
}

export default function BestWayLogo3D({
  glow = true,
  particles = true,
  className,
  style,
}: BestWayLogo3DProps) {
  return (
    <div className={className} style={{ width: "100%", height: "100%", ...style }}>
      <Canvas
        flat // no tone mapping: keeps the exact logo colours
        dpr={[1, 2.5]}
        gl={{ antialias: true, alpha: true }}
        camera={{ fov: 35, near: 0.5, far: 60, position: [0, 0, 9] }}
      >
        <Scene glow={glow} particles={particles} />
      </Canvas>
    </div>
  );
}
