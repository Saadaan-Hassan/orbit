import path from "path";
import { defineConfig } from "vitest/config";

// Separate from vite.config.ts, which carries Tauri-dev-specific server
// settings (fixed port, HMR host) that have no meaning for a test run.
export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  test: {
    environment: "node",
  },
});
