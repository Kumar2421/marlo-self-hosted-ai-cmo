import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Playwright E2E suite and its generated output (run via `npm run e2e`).
    "e2e/**",
    // Standalone publishable packages with their own tooling.
    "packages/**",
    "playwright-report/**",
    "test-results/**",
  ]),
]);

export default eslintConfig;
