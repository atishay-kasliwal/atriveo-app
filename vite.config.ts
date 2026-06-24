import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Local API target. Default: live production backend so auth/login works while
// viewing the frontend locally. Override with VITE_API_TARGET=http://localhost:8788
// to hit a local `wrangler pages dev` backend instead.
const API_TARGET = process.env.VITE_API_TARGET || "https://application.atriveo.com";

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      "/api": {
        target: API_TARGET,
        changeOrigin: true,
        secure: true,
      },
    },
  },
});
