import path from "path";
import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { sentryVitePlugin } from "@sentry/vite-plugin";

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  // loadEnv reads app/.env and app/.env.[mode] — gives the Sentry plugin
  // access to SENTRY_AUTH_TOKEN without relying on process.env directly.
  const env = loadEnv(mode, process.cwd(), "");

  // @ts-expect-error process is a nodejs global
  const host = process.env.TAURI_DEV_HOST;

  return {
    plugins: [
      react(),
      tailwindcss(),
      // Sentry plugin uploads source maps on production builds so stack traces
      // in the dashboard show original TypeScript lines, not minified output.
      // `filesToDeleteAfterUpload` removes .map files after upload so they are
      // never publicly served from the Tauri bundle.
      // Skipped automatically in dev when SENTRY_AUTH_TOKEN is not set.
      sentryVitePlugin({
        org: env.SENTRY_ORG,
        project: env.SENTRY_PROJECT,
        authToken: env.SENTRY_AUTH_TOKEN,
        disable: !env.SENTRY_AUTH_TOKEN,
        sourcemaps: {
          filesToDeleteAfterUpload: ["./**/*.map"],
        },
      }),
    ],

    resolve: {
      alias: {
        "@": path.resolve(__dirname, "./src"),
      },
    },

    build: {
      // "hidden" generates source maps and uploads them to Sentry, then
      // deletes them — they never ship inside the Tauri .dmg bundle.
      sourcemap: "hidden",
    },

    // Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`
    //
    // 1. prevent Vite from obscuring rust errors
    clearScreen: false,
    // 2. tauri expects a fixed port, fail if that port is not available
    server: {
      port: 1420,
      strictPort: true,
      host: host || false,
      hmr: host
        ? {
            protocol: "ws",
            host,
            port: 1421,
          }
        : undefined,
      watch: {
        // 3. tell Vite to ignore watching `src-tauri`
        ignored: ["**/src-tauri/**"],
      },
    },
  };
});
