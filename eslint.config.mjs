// Root ESLint flat config for the whole monorepo.
import js from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    // .agent/ and .agents/ hold the local agy dispatch kit (not in git); the agent must never edit them to satisfy lint.
    ignores: ["**/node_modules/**", "**/dist/**", "**/.next/**", "**/coverage/**", "**/next-env.d.ts", ".agent/**", ".agents/**"],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: { globals: { ...globals.node } },
    rules: {
      "no-console": ["error", { allow: ["warn", "error"] }],
      "@typescript-eslint/no-explicit-any": "error",
    },
  },
  {
    // Standalone CommonJS browser-test scripts (run with node, not bundled): require() and console output are expected.
    files: ["tests/e2e/**/*.cjs"],
    languageOptions: { sourceType: "commonjs" },
    rules: { "@typescript-eslint/no-require-imports": "off", "no-console": "off" },
  },
);
