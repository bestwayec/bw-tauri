# Best Way 3D logo (React)

    npm i three @react-three/fiber

Files: `BestWayLogo3D.jsx` (component) + `bestway-logo-data.json` (logo vector data, keep next to it).
Needs a bundler that imports JSON (Vite, Next.js, CRA all do).

    import BestWayLogo3D from './BestWayLogo3D'
    <div style={{ height: 480, background: 'radial-gradient(ellipse at 50% 45%,#0f2a2a,#050a12 72%)' }}>
      <BestWayLogo3D />
    </div>

Props: interactive (default true), glow (true), particles (true), className, style.
