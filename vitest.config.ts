// Test-only config. The app build keeps using vite.config.ts; vitest picks this
// file up instead so the suites run on plain Node without the app's SSR plugins.
//
// CI adds a JUnit file per shard (see .github/workflows/access-matrix.yml) so a
// failure report names the persona and route that regressed.
import { defineConfig } from "vitest/config";
import { resolve } from "node:path";

const isCI = !!process.env.CI;
const junitOut = process.env.VITEST_JUNIT_OUTPUT ?? "reports/junit/results.xml";

export default defineConfig({
  resolve: {
    alias: { "@": resolve(import.meta.dirname, "./src") },
  },
  test: {
    include: ["tests/**/*.test.ts"],
    environment: "node",
    reporters: isCI
      ? ["default", ["junit", { outputFile: junitOut, suiteName: "trademind" }]]
      : ["default"],
    // Persona shards are independent, so let them run wide.
    pool: "threads",
    sequence: { shuffle: false },
  },
});
