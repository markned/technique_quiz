import js from "@eslint/js";
import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";
import prettierConfig from "eslint-config-prettier";

export default tseslint.config(
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["src/**/*.{ts,tsx}"],
    plugins: {
      "react-hooks": reactHooks,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      "@typescript-eslint/no-explicit-any": "warn",
      "@typescript-eslint/no-unused-vars": "off", // tsc уже проверяет
      // Намеренный паттерн "sync-ref": `someRef.current = value` в render-теле хука
      // сохраняет актуальные значения для callbacks без stale closure.
      "react-hooks/refs": "warn",
      // setState синхронно внутри эффекта используется намеренно для анимационных сбросов.
      "react-hooks/set-state-in-effect": "warn",
    },
  },
  {
    ignores: ["dist/**", "dist-test/**", "node_modules/**", "worker-bindings.d.ts"],
  },
  {
    files: ["scripts/**/*.mjs", "*.js"],
    languageOptions: {
      globals: Object.fromEntries(
        [
          "process",
          "console",
          "Buffer",
          "setTimeout",
          "clearTimeout",
          "setInterval",
          "clearInterval",
          "WebSocket",
          "fetch",
          "URL",
          "URLSearchParams",
          "AbortSignal",
          "TextDecoder",
          "TextEncoder",
        ].map((n) => [n, "readonly"]),
      ),
    },
  },
  {
    files: ["server/**/*.ts", "party/**/*.ts", "test/**/*.ts", "e2e/**/*.ts", "vite/**/*.ts", "*.ts"],
    rules: { "@typescript-eslint/no-explicit-any": "warn", "@typescript-eslint/no-unused-vars": "off" },
  },
  {
    files: ["party/server.ts"],
    rules: {
      "@typescript-eslint/triple-slash-reference": [
        "error",
        { path: "always", types: "prefer-import", lib: "always" },
      ],
    },
  },
  prettierConfig,
);
