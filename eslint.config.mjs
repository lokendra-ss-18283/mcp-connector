import js from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";
import { defineConfig } from "eslint/config";

export default defineConfig([
  {
    ignores: [".vscode/", "node_modules/", "dist/", "build/", "public/", "templates/","*.js"],
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
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "warn",
        {
          vars: "all",
          args: "after-used",
          ignoreRestSiblings: true
        },
      ],
      "no-unused-vars": "off"
    },
  },
  {
       files: ["src/**/*.{ts,tsx}"],
       languageOptions: {
           globals: globals.browser, // Add browser APIs like 'window', 'document' etc.
       }
   }
]);