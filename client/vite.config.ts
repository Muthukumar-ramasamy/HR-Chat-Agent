import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// In dev, /api requests are forwarded to the Express server, so the browser talks to one origin.
// API_URL overrides the target (e.g. a second API instance on another port).
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: { "/api": process.env.API_URL ?? "http://localhost:3001" },
  },
});
