import js from "@eslint/js"
import tsPlugin from "@typescript-eslint/eslint-plugin"
import tsParser from "@typescript-eslint/parser"
import prettier from "eslint-config-prettier"
import importX from "eslint-plugin-import-x"
import svelte from "eslint-plugin-svelte"
import globals from "globals"

const projectGlobals = Object.fromEntries(
  [
    "Data",
    "SummaryData",
    "CPUData",
    "MemData",
    "NetData",
    "DiskData",
    "TempData",
    "IOData",
    "BatteryData",
    "Process"
  ].map(name => [name, "readonly"])
)

export default [
  {
    ignores: ["src-tauri/**", "package-lock.json", "dist/**"]
  },
  js.configs.recommended,
  ...tsPlugin.configs["flat/recommended"],
  ...svelte.configs["flat/recommended"],
  importX.flatConfigs.recommended,
  {
    files: ["**/*.{js,mjs,cjs,ts,svelte}"],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "module",
      globals: {
        ...globals.browser,
        ...globals.node,
        ...projectGlobals
      }
    },
    rules: {
      "@typescript-eslint/ban-ts-comment": "off",
      "@typescript-eslint/no-empty-function": "off",
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-non-null-assertion": "off",
      "@typescript-eslint/no-unused-vars": "off",
      camelcase: ["error", { properties: "never", ignoreDestructuring: true }],
      eqeqeq: "error",
      "func-names": "error",
      "import-x/order": "error",
      "import-x/no-unresolved": "off",
      "no-unused-vars": ["error", { varsIgnorePattern: "^_", argsIgnorePattern: "^_" }],
      "no-var": "error",
      "prefer-arrow-callback": "error",
      "prefer-const": "off",
      "require-await": "error"
    }
  },
  {
    files: ["**/*.svelte"],
    languageOptions: {
      parserOptions: {
        parser: tsParser
      }
    }
  },
  prettier
]
