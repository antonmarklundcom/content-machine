// ESLint flat config (PLAN.md §1.25, §6.S9): Next's core-web-vitals rules plus
// typescript-eslint's recommended set, with Prettier owning formatting.
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { FlatCompat } from "@eslint/eslintrc";
import tseslint from "typescript-eslint";
import prettier from "eslint-config-prettier";

const compat = new FlatCompat({ baseDirectory: dirname(fileURLToPath(import.meta.url)) });

export default tseslint.config(
  {
    ignores: [
      ".next/**",
      "node_modules/**",
      "drizzle/**",
      "docs/screenshots/**",
      "media/**",
      "next-env.d.ts",
      // Cloudflare Workers (S16) have their own package.json and tsconfig.
      "workers/**",
    ],
  },
  ...compat.extends("next/core-web-vitals"),
  ...tseslint.configs.recommended,
  {
    rules: {
      // `_`-prefixed names are the repo's "deliberately unused" marker.
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_", caughtErrorsIgnorePattern: "^_" },
      ],
    },
  },
  prettier,
);
