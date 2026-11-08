import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { FlatCompat } from "@eslint/eslintrc";

const compat = new FlatCompat({
  baseDirectory: dirname(fileURLToPath(import.meta.url)),
});

const eslintConfig = [
  {
    ignores: [
      "node_modules/",
      ".next/",
      ".next-dev/",
      ".next-integration/",
      ".data/",
      "out/",
      "playwright-report/",
      "test-results/",
      "next-env.d.ts",
    ],
  },
  ...compat.extends("next/core-web-vitals", "next/typescript"),
  {
    // Test harnesses assert against untyped JSON responses.
    files: ["scripts/**/*.ts", "tests/**/*.ts"],
    rules: { "@typescript-eslint/no-explicit-any": "off" },
  },
];

export default eslintConfig;
