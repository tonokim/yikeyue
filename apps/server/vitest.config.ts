import { defineConfig } from "vitest/config";

/**
 * Vitest configuration for the server app.
 * Design Invariant: 10.1, 10.2 - Configures v8 coverage thresholds & global setup script.
 * Thresholds: lines >= 80%, branches >= 70%, functions >= 80%.
 * Exempts db/migrations and packages/shared from coverage checks.
 */
export default defineConfig({
  test: {
    environment: "node",
    globalSetup: "./tests/global-setup.ts",
    coverage: {
      provider: "v8",
      reporter: ["text", "json", "html"],
      lines: 80,
      branches: 70,
      functions: 80,
      statements: 80,
      exclude: [
        "src/db/migrations/**",
        "packages/shared/**",
        "**/node_modules/**",
        "dist/**",
        "vitest.config.ts",
        "drizzle.config.ts",
        "tests/**",
        "src/index.ts", // exclude production bootstrap entrypoint
        "src/worker.ts", // exclude worker bootstrap entrypoint
        "src/config.ts", // config loader
        "src/db/migrate.ts", // migration runner script
        "src/db/seed.ts",
      ],
    },
  },
});
