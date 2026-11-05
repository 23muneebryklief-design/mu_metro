import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  server: {
    port: Number(process.env.FRONTEND_PORT || 5173),
    strictPort: true,
    proxy: {
      "/api": process.env.API_PROXY_TARGET || "http://127.0.0.1:3000",
      "/health": process.env.API_PROXY_TARGET || "http://127.0.0.1:3000",
    },
  },
});
