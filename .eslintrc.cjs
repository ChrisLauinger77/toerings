module.exports = {
  root: true,
  parser: "@typescript-eslint/parser",
  extends: [
    "eslint:recommended",
    "plugin:@typescript-eslint/recommended",
    "plugin:import/recommended",
    "plugin:svelte/recommended",
    "prettier"
  ],
  plugins: ["@typescript-eslint"],
  overrides: [
    {
      files: ["*.svelte"],
      parser: "svelte-eslint-parser",
      parserOptions: {
        parser: "@typescript-eslint/parser"
      }
    }
  ],
  parserOptions: {
    sourceType: "module",
    ecmaVersion: 2022
  },
  env: {
    browser: true,
    es2017: true,
    node: true
  },
  globals: {
    Data: true,
    SummaryData: true,
    CPUData: true,
    MemData: true,
    NetData: true,
    DiskData: true,
    TempData: true,
    IOData: true,
    BatteryData: true,
    Process: true
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
    "import/order": "error",
    "import/no-unresolved": "off",
    "no-unused-vars": ["error", { varsIgnorePattern: "^_", argsIgnorePattern: "^_" }],
    "no-var": "error",
    "prefer-arrow-callback": "error",
    "prefer-const": "off",
    "require-await": "error"
  }
}
