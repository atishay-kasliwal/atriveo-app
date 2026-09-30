import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// apply.atriveo.com — the application-engine console, built as its own small site.
// Output: dist-apply/ (apply.html is renamed to index.html after the build; see package.json).
// No public/ copy: the job-feed JSON belongs to application.atriveo.com only.
export default defineConfig({
  plugins: [react()],
  publicDir: false,
  build: {
    outDir: "dist-apply",
    emptyOutDir: true,
    rollupOptions: { input: "apply.html" },
  },
  server: {
    open: "/apply.html",
    proxy: {
      "/api": { target: process.env.VITE_API_TARGET || "https://apply.atriveo.com", changeOrigin: true, secure: true },
    },
  },
});
