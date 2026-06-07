import { defineConfig } from "vite";
import { crx } from "@crxjs/vite-plugin";
import manifest from "./manifest.json";

export default defineConfig({
  plugins: [
    crx({ manifest }),
  ],
  build: {
    // Emit source maps in development so errors in the service worker
    // point back to the TypeScript source in DevTools.
    sourcemap: true,
  },
});
