import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: { alias: { "@vicepulse/shared": path.resolve(import.meta.dirname, "packages/shared/src/index.ts") } },
  test: {
    include: ["tests/**/*.test.ts"],
    environment: "node",
    pool: "forks",
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
