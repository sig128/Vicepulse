import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const api = process.env.VICEPULSE_API ?? "http://127.0.0.1:8787";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      "/api": { target: api, changeOrigin: false },
      "/tiles": { target: api },
      "/media": { target: api },
      "/ws": { target: api.replace(/^http/, "ws"), ws: true },
    },
  },
  build: { target: "es2022", chunkSizeWarningLimit: 1500 },
});
