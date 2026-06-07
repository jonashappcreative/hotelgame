/// <reference types="vitest" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import { componentTagger } from "lovable-tagger";

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => ({
  server: {
    host: "localhost",
    port: 5173,
    proxy: {
      // Forward /api/* to the local Netlify functions server (netlify functions:serve).
      // Replicates the redirects in netlify.toml without going through netlify dev,
      // which breaks Vite's HMR by applying the SPA catch-all to Vite module requests.
      '/api/auth/anonymous': { target: 'http://localhost:9999', rewrite: () => '/.netlify/functions/auth-anonymous' },
      '/api/auth/signup':    { target: 'http://localhost:9999', rewrite: () => '/.netlify/functions/auth-signup' },
      '/api/auth/login':     { target: 'http://localhost:9999', rewrite: () => '/.netlify/functions/auth-login' },
      '/api/game-action':    { target: 'http://localhost:9999', rewrite: () => '/.netlify/functions/game-action' },
      '/api/rooms':          { target: 'http://localhost:9999', rewrite: () => '/.netlify/functions/rooms' },
      '/api/account':        { target: 'http://localhost:9999', rewrite: () => '/.netlify/functions/account' },
    },
  },
  plugins: [react(), mode === "development" && componentTagger()].filter(Boolean),
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
    include: [
      "src/**/*.{test,spec}.{js,mjs,cjs,ts,mts,cts,jsx,tsx}",
      "netlify/**/*.{test,spec}.{js,mjs,cjs,ts,mts,cts,jsx,tsx}",
    ],
  },
}));
