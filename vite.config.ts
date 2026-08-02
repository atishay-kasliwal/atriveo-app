import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Local API target. Default: live production backend so auth/login works while
// viewing the frontend locally. Override with VITE_API_TARGET=http://localhost:8788
// to hit a local `wrangler pages dev` backend instead.
const API_TARGET = process.env.VITE_API_TARGET || "https://application.atriveo.com";

// ever-jobs aggregator (Spec 1678). Deliberately NOT under /api — that prefix already
// proxies to the production Atriveo backend, so the Ever Jobs tab needs its own path or it
// would shadow real endpoints. Start the aggregator with PORT=3100 in ~/ever-jobs.
const EVERJOBS_TARGET = process.env.VITE_EVERJOBS_TARGET || "http://localhost:3100";

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      "/everjobs-api": {
        target: EVERJOBS_TARGET,
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/everjobs-api/, ""),
        // A wide fan-out routinely runs past 20s.
        timeout: 240_000,
        proxyTimeout: 240_000,
      },
      "/api": {
        target: API_TARGET,
        changeOrigin: true,
        secure: true,
      },
    },
  },
});
