import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "node:path";

// https://vite.dev/config/
// NOTE (CSP TA-12): Tailwind v4 prod output is fully static — @tailwindcss/vite
// + Oxide/LightningCSS pre-compile all utilities into dist/assets/*.css with no
// client-side style injection. Only `vite dev` HMR injects runtime <style> tags
// (never shipped; frontendDist is ../dist). `style-src 'unsafe-inline'` is still
// required in the shipped app for React `style={{}}` attributes (19 sites),
// motion/react frame writes, body scroll-lock, and OGL canvas sizing — NOT for
// Tailwind. The sole static <style> block (index.html boot splash) is additionally
// pinned via a sha256 hash in tauri.conf.json CSP.
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), 'BESTWAY_');
  return {
  plugins: [react(), tailwindcss()],
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
  },
  // Only expose explicitly intended env vars to the client bundle.
  // Adding a new BESTWAY_* secret on the build host would otherwise be baked into the JS.
  envPrefix: ["VITE_"],
  define: {
    'import.meta.env.BESTWAY_API_URL': JSON.stringify(env.BESTWAY_API_URL) ?? 'undefined',
    'import.meta.env.BESTWAY_WEB_URL': JSON.stringify(env.BESTWAY_WEB_URL) ?? 'undefined',
  },
  build: {
    // Do not emit sourcemaps in production — leaks source and aids exploit chaining.
    sourcemap: false,
    minify: "esbuild",
    // Lab PCs run modern WebViews: es2022 output is smaller and faster.
    target: "es2022",
    rolldownOptions: {
      output: {
        // Keep the initial chunk lean: React core + Tauri IPC separate from
        // route chunks (three.js splash, exam runners load on demand).
        // (Rolldown-native; Vite 8 does not accept the old manualChunks object.)
        codeSplitting: {
          groups: [
            { name: "vendor-react", test: /node_modules[\\/](react|react-dom|scheduler)[\\/]/ },
            {
              name: "vendor-tauri",
              test: /node_modules[\\/]@tauri-apps[\\/]/,
            },
            {
              name: "vendor-query",
              test: /node_modules[\\/]_?(@tanstack|zustand)[\\/]/,
            },
          ],
        },
      },
    },
  },
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "./src"),
    },
  },
  };
});
