import eslint from "@eslint/js";
import tseslint from "typescript-eslint";
import eslintConfigPrettier from "eslint-config-prettier";

export default tseslint.config(
  eslint.configs.recommended,
  ...tseslint.configs.strictTypeChecked,
  eslintConfigPrettier,
  {
    languageOptions: {
      parserOptions: {
        projectService: {
          allowDefaultProject: ["packages/*/test/*.ts", "packages/*/test/remote/*.ts"],
          defaultProject: "tsconfig.base.json",
        },
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      "@typescript-eslint/restrict-template-expressions": "off",
      "@typescript-eslint/no-unnecessary-condition": "warn",
    },
  },
  {
    ignores: [
      "**/dist/",
      "node_modules/",
      "package/",
      "scripts/",
      "eslint.config.js",
      "vitest.config.ts",
      "packages/*/tsup.config.ts",
    ],
  },
);
