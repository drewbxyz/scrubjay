import { resolve } from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": resolve(__dirname, "src"),
    },
  },
  test: {
    coverage: {
      exclude: ["src/**/*.spec.ts", "src/testing/**"],
      include: ["src/**/*.ts"],
      provider: "v8",
      reportsDirectory: "./coverage",
    },
    environment: "node",
    globalSetup: ["src/testing/global-setup.ts"],
    include: ["src/**/*.spec.ts"],
  },
});
