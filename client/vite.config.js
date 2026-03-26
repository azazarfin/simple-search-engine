import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

/**
 * Vite Configuration
 * ------------------
 * The `server.proxy` setting is the key piece for development:
 *
 * When the React app makes a request to "/api/search", Vite's dev server
 * intercepts it and forwards (proxies) it to http://localhost:5000 where
 * our Express backend is running.
 *
 * This avoids CORS issues during development without needing to hardcode
 * the backend URL in the frontend code.  In production, both would typically
 * be served from the same origin.
 */
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      "/api": {
        target: "http://localhost:5000",
        changeOrigin: true,
      },
    },
  },
});
