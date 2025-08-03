import js from "@eslint/js";
import tseslint from "typescript-eslint";
import { defineConfig } from "eslint/config";

import importPlugin from "eslint-plugin-import";

export default defineConfig([
  {
    ignores: [
      ".vscode/",
      "node_modules/",
      "dist/",
      "build/",
      "public/",
      "templates/",
      "*.js",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["**/*.ts", "**/*.tsx"],
    languageOptions: {
      parserOptions: {
        // improves the accuracy of rules like 'no-unused-vars' for class members.
        project: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    plugins: { import: importPlugin },
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "warn",
        {
          vars: "all",
          args: "after-used",
          ignoreRestSiblings: true,
        },
      ],
      "no-unused-vars": "off",

      "import/order": [
        "warn",
        {
          groups: [
            "builtin",
            "external",
            "internal",
            "parent",
            "sibling",
            "index",
            "object",
            "type",
          ],
          "newlines-between": "always",
        },
      ],
    },
  },
  {
    files: ["src/**/*.{ts,tsx}"],
  },
]);
