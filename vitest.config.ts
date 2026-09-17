import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    globals: false,
    forceRerunTriggers: ["**/{package,server}.json", "**/{vitest,vite}.config.*/**", "src/**"],
  },
});
