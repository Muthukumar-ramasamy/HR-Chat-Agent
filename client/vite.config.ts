import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// In dev, /api requests are forwarded to the Express server, so the browser talks to one origin.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: { "/api": "http://localhost:3001" },
  },
});
