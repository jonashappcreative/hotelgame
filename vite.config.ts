/// <reference types="vitest" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => ({
  server: {
    host: "localhost",
    port: 5173,
    proxy: {
      // Forward /api/* and Socket.IO to the local Hono backend (server/server.ts,
      // `cd server && npm start`). The backend mounts these paths directly, so no
      // rewrite is needed — this mirrors what Caddy does in production.
      '/api': { target: 'http://localhost:3000', changeOrigin: true },
      '/socket.io': { target: 'http://localhost:3000', changeOrigin: true, ws: true },
    },
  },
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  esbuild: {
    // Strip console.log and console.warn in production builds
    drop: mode === "production" ? ["console", "debugger"] : [],
  },
  test: {
    globals: true,
    environment: "jsdom",
    setupFiles: ["./src/test/setup.ts"],
    // vitest 4's default "threads" pool fails to spawn workers on macOS here and
    // reports 0 tests run. "forks" is unaffected and costs ~nothing at this suite
    // size, so it's the default everywhere rather than a local-only workaround.
    pool: "forks",
    include: [
      "src/**/*.{test,spec}.{js,mjs,cjs,ts,mts,cts,jsx,tsx}",
      "server/**/*.{test,spec}.{js,mjs,cjs,ts,mts,cts,jsx,tsx}",
    ],
  },
}));
