import js from "@eslint/js";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import { globalIgnores } from "eslint/config";
import tseslint from "typescript-eslint";

export default tseslint.config(
  globalIgnores(["dist/**", "src-tauri/**"]),
  {
    files: ["**/*.{ts,tsx}"],
    extends: [js.configs.recommended, ...tseslint.configs.recommended, reactHooks.configs.flat["recommended-latest"]],
    plugins: {
      "react-refresh": reactRefresh,
    },
    rules: {
      "react-refresh/only-export-components": ["warn", { allowConstantExport: true }],
      // useState setters, chrome/tauri event payloads, and catch blocks
      // legitimately go unused in places — noUnusedLocals/Parameters in
      // tsconfig.json already catches genuinely dead code at the type level.
      "@typescript-eslint/no-unused-vars": ["warn", { argsIgnorePattern: "^_" }],
      // react-hooks v7's recommended set adds this Compiler-readiness rule,
      // which flags the standard fetch-on-mount pattern (an async function
      // called from an effect body that eventually calls setState) used
      // throughout this codebase's data hooks. The other new v7 rules are
      // kept — only this one conflicts with an established, intentional
      // pattern here.
      "react-hooks/set-state-in-effect": "off",
    },
  },
);
