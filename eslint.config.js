import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      // Allow explicit any in a security-focused service where unsafe casts are intentional
      "@typescript-eslint/no-explicit-any": "warn",
      // Unused vars are errors except for underscore-prefixed names
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_" }],
    },
  },
  {
    // Ignore compiled output and node_modules
    ignores: ["dist/**", "node_modules/**"],
  },
);
