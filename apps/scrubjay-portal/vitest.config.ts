import tsconfigPaths from "vite-tsconfig-paths";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    // Placeholder values so modules that call env() at import time (e.g.
    // auth.ts) can load under vitest without a real .env. Individual specs
    // (bot-api.spec.ts) override via vi.stubEnv where they need specific
    // values.
    env: {
      BETTER_AUTH_SECRET: "s".repeat(32),
      BETTER_AUTH_URL: "http://localhost:3100",
      BOT_API_URL: "http://localhost:3000",
      DATABASE_URL: "postgresql://u:p@localhost:5432/db",
      DISCORD_CLIENT_ID: "abc",
      DISCORD_CLIENT_SECRET: "def",
      PORTAL_OPERATOR_IDS: "123456789012345678",
      SCRUBJAY_API_TOKEN: "t".repeat(32),
    },
    environment: "node",
    include: ["src/**/*.spec.ts", "src/**/*.spec.tsx"],
    passWithNoTests: true,
  },
});
