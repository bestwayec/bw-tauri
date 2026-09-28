import { defineConfig } from "vite";
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
export default defineConfig({
  plugins: [react(), tailwindcss()],
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
  },
  // Only expose explicitly intended env vars to the client bundle.
  // Adding a new BESTWAY_* secret on the build host would otherwise be baked into the JS.
  envPrefix: ["BESTWAY_", "VITE_"],
  build: {
    // Do not emit sourcemaps in production — leaks source and aids exploit chaining.
    sourcemap: false,
    minify: "esbuild",
  },
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "./src"),
    },
  },
});
